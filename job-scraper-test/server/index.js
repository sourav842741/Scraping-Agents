import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { collectJobs } from "../src/collect-jobs.js";
import {
  buildSearchUrls,
  parseExtractFilters,
  POSTED_WITHIN_OPTIONS,
  WORK_TYPE_OPTIONS,
  SORT_OPTIONS,
  LINKEDIN_EXPERIENCE_OPTIONS,
  INDEED_EXPERIENCE_OPTIONS,
  INDEED_JOB_TYPE_OPTIONS,
} from "../src/search-url-builder.js";
import {
  saveExtractionRun,
  listExtractionHistory,
  getExtractionRun,
  makeRunId,
} from "../src/history-store.js";
import { buildRunSummary } from "../src/run-summary.js";
import {
  loadProxyEnv,
  isProxyConfigured,
  getProxyPublicConfig,
  createProxySessionManager,
  locationToCountryCode,
  fetchProxyList,
} from "../src/webshare-proxy.js";

loadProxyEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dashboardDist = join(root, "dashboard", "dist");
const screenshotsDir = join(root, "output", "screenshots");

const app = express();
const PORT = Number(process.env.PORT ?? 3847);
const HOST =
  process.env.HOST ??
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

let activeRun = null;
let abortController = null;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
} else {
  app.use(cors());
}
app.use(express.json());

function loadDefaultUrls() {
  try {
    const raw = JSON.parse(readFileSync(join(root, "test-urls.json"), "utf8"));
    return {
      linkedin: raw.linkedin?.searchUrl ?? "",
      indeed: raw.indeed?.searchUrl ?? "",
    };
  } catch {
    return { linkedin: "", indeed: "" };
  }
}

function clearActiveRun() {
  activeRun = null;
  abortController = null;
}

app.get("/api/config", (_req, res) => {
  const defaults = loadDefaultUrls();
  const built = buildSearchUrls({
    keywords: "software engineer",
    location: "United States",
    postedWithin: "24h",
    sort: "date",
  });
  res.json({
    ...defaults,
    filterOptions: {
      postedWithin: POSTED_WITHIN_OPTIONS,
      workType: WORK_TYPE_OPTIONS,
      sort: SORT_OPTIONS,
      linkedinExperience: LINKEDIN_EXPERIENCE_OPTIONS,
      indeedExperience: INDEED_EXPERIENCE_OPTIONS,
      indeedJobType: INDEED_JOB_TYPE_OPTIONS,
    },
    defaults: {
      keywords: "software engineer",
      location: "United States",
      separateLocations: false,
      linkedinLocation: "United States",
      indeedLocation: "Remote",
      postedWithin: "24h",
      customHours: 24,
      sort: "date",
      linkedinWorkType: "any",
      indeedWorkType: "remote",
      linkedinExperience: "any",
      indeedExperience: "entry",
      indeedJobType: "any",
      quantity: 50,
    },
    built,
    proxy: getProxyPublicConfig(),
  });
});

app.get("/api/proxy/status", (_req, res) => {
  res.json(getProxyPublicConfig());
});

app.get("/api/build-urls", (req, res) => {
  const filters = {
    keywords: req.query.keywords ?? "",
    location: req.query.location ?? "",
    separateLocations: req.query.separateLocations === "true",
    linkedinLocation: req.query.linkedinLocation ?? req.query.location ?? "",
    indeedLocation: req.query.indeedLocation ?? req.query.location ?? "",
    postedWithin: req.query.postedWithin ?? "any",
    customHours: req.query.customHours ?? "24",
    sort: req.query.sort ?? "date",
    linkedinWorkType: req.query.linkedinWorkType ?? "any",
    indeedWorkType: req.query.indeedWorkType ?? "any",
    linkedinExperience: req.query.linkedinExperience ?? "any",
    indeedExperience: req.query.indeedExperience ?? "any",
    indeedJobType: req.query.indeedJobType ?? "any",
  };
  res.json(buildSearchUrls(filters));
});

app.use("/api/screenshots", express.static(screenshotsDir));

app.get("/api/status", (_req, res) => {
  res.json({
    running: Boolean(activeRun),
    runId: activeRun?.runId ?? null,
    startedAt: activeRun?.startedAt ?? null,
  });
});

app.post("/api/extract/reset", (_req, res) => {
  if (abortController) abortController.abort();
  clearActiveRun();
  res.json({ reset: true });
});

app.post("/api/extract/cancel", (_req, res) => {
  if (abortController) {
    abortController.abort();
  }
  res.json({ cancelled: true });
});

app.get("/api/history", (_req, res) => {
  res.json({ runs: listExtractionHistory() });
});

app.get("/api/history/:id", (req, res) => {
  const run = getExtractionRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (!run.summary) {
    const linkedinCount = (run.jobs ?? []).filter((j) => j.site === "linkedin").length;
    const indeedCount = (run.jobs ?? []).filter((j) => j.site === "indeed").length;
    const siteResults = {};
    for (const site of run.sites ?? []) {
      const c = site === "linkedin" ? linkedinCount : indeedCount;
      siteResults[site] = {
        site,
        ok: c > 0,
        count: c,
        block: null,
        error: null,
      };
    }
    let status = run.status ?? "unknown";
    const target = (run.quantity ?? 0) * (run.sites?.length ?? 1);
    if (status === "completed" && (run.totalCollected ?? 0) < target * 0.9) {
      status = "partial";
    }
    run.summary = buildRunSummary({
      status,
      totalCollected: run.totalCollected,
      quantity: run.quantity,
      sites: run.sites,
      siteResults,
      error: run.error,
      filters: run.filters,
    });
  }

  res.json(run);
});

app.get("/api/extract/stream", async (req, res) => {
  if (activeRun) {
    res.status(409).json({
      error: "An extraction is already running",
      runId: activeRun.runId,
      startedAt: activeRun.startedAt,
    });
    return;
  }

  const sites = (req.query.sites ?? "linkedin")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ["linkedin", "indeed"].includes(s));

  if (sites.length === 0) {
    res.status(400).json({ error: "Invalid sites" });
    return;
  }

  const { quantity, filters, linkedinUrl, indeedUrl, built } =
    parseExtractFilters(req.query);

  const headless = req.query.headless !== "false";
  const proxyMode = req.query.proxyMode === "true" || req.query.proxy === "true";
  const runId = makeRunId();
  const startedAt = new Date().toISOString();

  let proxyManager = null;
  let proxyReport = {
    mode: "local",
    configured: isProxyConfigured(),
    totalRotations: 0,
    rotations: [],
    summary: null,
  };

  if (proxyMode) {
    if (!isProxyConfigured()) {
      res.status(400).json({
        error: "Proxy mode enabled but Webshare not configured",
        hint: "Set WEBSHARE_API_KEY in .env (get from https://proxy.webshare.io/)",
        docs: getProxyPublicConfig().docs,
      });
      return;
    }
    try {
      await fetchProxyList({ forceRefresh: true });
      const loc =
        filters.location ??
        filters.linkedinLocation ??
        filters.indeedLocation ??
        "";
      const country =
        locationToCountryCode(loc) ||
        process.env.WEBSHARE_PROXY_COUNTRY?.trim()?.toLowerCase() ||
        null;
      proxyManager = createProxySessionManager({
        country,
        locationLabel: loc || (country ? country.toUpperCase() : "Global"),
      });
      await proxyManager.init();
      proxyReport = { mode: "proxy", configured: true, ...proxyManager.buildReport() };
    } catch (proxyErr) {
      res.status(400).json({
        error: proxyErr.message,
        hint: "Set WEBSHARE_API_KEY in .env with a valid key from https://proxy.webshare.io/",
        docs: getProxyPublicConfig().docs,
      });
      return;
    }
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  activeRun = { runId, startedAt: Date.now() };
  abortController = new AbortController();
  const signal = abortController.signal;

  const allJobs = [];
  const activityLog = [];
  const siteResults = {};
  let runStatus = "running";
  let lastError = null;

  const pushLog = (text, level = "info") => {
    const entry = { t: new Date().toISOString(), text, level };
    activityLog.push(entry);
    send("log", entry);
  };

  const heartbeat = setInterval(() => {
    send("ping", { t: Date.now() });
  }, 12000);

  req.on("close", () => {
    clearInterval(heartbeat);
    if (!res.writableEnded && signal && !signal.aborted) {
      abortController?.abort();
      runStatus = "disconnected";
    }
  });

  try {
    pushLog(
      `Run started · ${sites.join(" + ")} · ${quantity} jobs/site · ${proxyMode ? "Webshare proxy" : "local IP"}`,
      "success"
    );

    send("run-start", {
      runId,
      sites,
      quantity,
      headless,
      proxyMode,
      proxyReport: proxyManager ? proxyManager.buildReport() : proxyReport,
      filters,
      urls: { linkedin: linkedinUrl, indeed: indeedUrl, built },
    });

    for (const site of sites) {
      if (signal.aborted) break;

      const searchUrl = site === "linkedin" ? linkedinUrl : indeedUrl;
      if (!searchUrl) {
        send("error", { site, message: `Missing search URL for ${site}` });
        continue;
      }

      pushLog(`${site} → ${searchUrl}`, "info");
      send("site-start", { site, quantity, searchUrl, filters });

      const handleCollectEvent = ({ type, ...data }) => {
          if (type === "proxy-rotation" || type === "proxy-ip" || type === "proxy-rotation-complete") {
            if (type === "proxy-rotation") {
              pushLog(data.message, "info");
            } else if (type === "proxy-ip") {
              const ip = data.ipCheck;
              pushLog(
                `Proxy #${data.rotationIndex} egress: ${ip?.ip ?? "?"} · ${ip?.city ?? "?"}, ${ip?.country ?? "?"}`,
                ip?.ok ? "success" : "warn"
              );
            } else if (type === "proxy-rotation-complete") {
              pushLog(
                `Proxy rotation #${data.rotation?.index} done · ${data.rotation?.scrapeJobs ?? 0} jobs`,
                "success"
              );
            }
            if (proxyManager) {
              proxyReport = proxyManager.buildReport();
              send("proxy-report", { proxyReport });
            }
            send(type, data);
          } else if (type === "progress") {
            allJobs.push(data.job);
            if (
              data.current === 1 ||
              data.current % 5 === 0 ||
              data.current === data.total
            ) {
              pushLog(
                `[${data.current}/${data.total}] ${data.job?.title ?? "?"} @ ${data.job?.company ?? "?"}`,
                "success"
              );
            }
          } else if (type === "status") {
            pushLog(data.message, "info");
          } else if (type === "block") {
            pushLog(
              `Blocked on ${data.site}: ${data.reasons?.join(", ")}`,
              "error"
            );
            runStatus = "blocked";
          } else if (type === "plateau") {
            pushLog(data.message, "warn");
            runStatus = "plateau";
          } else if (type === "error") {
            pushLog(data.message ?? "Error", "error");
          } else if (type === "screenshot") {
            pushLog(`Snapshot saved (${data.site})`, "info");
          }
          send(type, data);
      };

      let result = await collectJobs({
        site,
        searchUrl,
        quantity,
        headless,
        signal,
        proxyManager,
        onEvent: handleCollectEvent,
      });

      const indeedBlockedOnProxy =
        site === "indeed" &&
        proxyManager &&
        (result.block?.reasons?.includes("http_403") ||
          (!result.ok && (result.jobs?.length ?? 0) === 0));

      let indeedFallback = null;
      if (indeedBlockedOnProxy) {
        pushLog(
          "Indeed blocked Webshare proxy (HTTP 403) — retrying on local IP",
          "warn"
        );
        indeedFallback = "local";
        if (runStatus === "blocked") runStatus = "running";
        result = await collectJobs({
          site,
          searchUrl,
          quantity,
          headless,
          signal,
          proxyManager: null,
          onEvent: handleCollectEvent,
        });
      }

      if (result.error) lastError = result.error;
      if (result.block?.blocked && !indeedFallback) runStatus = "blocked";

      const siteComplete = {
        site,
        ok: result.ok,
        count: result.jobs?.length ?? 0,
        block: result.block ?? null,
        error: result.error ?? null,
        indeedFallback,
      };
      siteResults[site] = siteComplete;
      pushLog(
        `${site} finished: ${siteComplete.count}/${quantity} jobs`,
        siteComplete.ok ? "success" : "warn"
      );

      send("site-complete", siteComplete);
    }

    const targetTotal = quantity * sites.length;

    if (signal.aborted) {
      runStatus = runStatus === "running" ? "cancelled" : runStatus;
    } else if (runStatus === "plateau") {
      /* keep plateau */
    } else if (runStatus === "blocked") {
      /* keep blocked */
    } else if (allJobs.length >= targetTotal) {
      runStatus = "completed";
    } else if (allJobs.length > 0) {
      runStatus = "partial";
    } else {
      runStatus = "empty";
    }

    const summary = buildRunSummary({
      status: runStatus,
      totalCollected: allJobs.length,
      quantity,
      sites,
      siteResults,
      error: lastError,
      filters,
    });

    pushLog(`${summary.title}: ${summary.diagnosis.split("\n")[0]}`, summary.outcome === "success" ? "success" : "warn");

    if (proxyManager) {
      proxyReport = proxyManager.buildReport();
      pushLog(
        `Proxy summary: ${proxyReport.summary.rotationsUsed} rotation(s), ${proxyReport.summary.uniqueEgressIps} unique IP(s)`,
        "info"
      );
      send("proxy-summary", { proxyReport });
    }

    send("run-complete", {
      runId,
      totalCollected: allJobs.length,
      jobs: allJobs,
      status: runStatus,
      summary,
      proxyMode,
      proxyReport,
    });
  } catch (err) {
    lastError = err.message;
    runStatus = "error";
    send("error", { message: err.message });
  } finally {
    clearInterval(heartbeat);

    const finishedAt = new Date().toISOString();
    const summary = buildRunSummary({
      status: runStatus,
      totalCollected: allJobs.length,
      quantity,
      sites,
      siteResults,
      error: lastError,
      filters,
    });

    try {
      saveExtractionRun({
        id: runId,
        startedAt,
        finishedAt,
        sites,
        quantity,
        filters,
        urls: { linkedin: linkedinUrl, indeed: indeedUrl, built },
        headless,
        jobs: allJobs,
        totalCollected: allJobs.length,
        status: runStatus,
        error: lastError,
        activityLog,
        siteResults,
        summary,
        proxyMode,
        proxyReport: proxyManager ? proxyManager.buildReport() : proxyReport,
      });
      send("history-saved", {
        runId,
        path: `output/history/${runId}.json`,
        summary,
      });
    } catch (saveErr) {
      send("error", { message: `Failed to save history: ${saveErr.message}` });
    }

    clearActiveRun();
    if (!res.writableEnded) res.end();
  }
});

if (existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(dashboardDist, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Job Extract OS API → http://${HOST}:${PORT}`);
  if (!existsSync(dashboardDist)) {
    console.log(`Dashboard dev UI → npm run dashboard:dev (port 5173)`);
  }
});
