import express from "express";
import cors from "cors";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { collectGoogleResults } from "../src/collect-google-results.js";
import {
  buildGoogleSearchUrl,
  parseExtractFilters,
} from "../src/google-url-builder.js";
import {
  saveExtractionRun,
  listExtractionHistory,
  getExtractionRun,
  makeRunId,
  updateResultRemarks,
} from "../src/history-store.js";
import { buildRunSummary } from "../src/run-summary.js";
import { resultsToCsv } from "../src/csv-export.js";
import { getSettings, saveSettings, getDefaultDownloadDir } from "../src/settings-store.js";
import {
  loadProxyEnv,
  isProxyConfigured,
  getProxyPublicConfig,
  createProxySessionManager,
  locationToCountryCode,
  resolveWebshareCredentials,
} from "../src/webshare-proxy.js";

loadProxyEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dashboardDist = join(root, "dashboard", "dist");

const app = express();
const PORT = Number(process.env.PORT ?? 3848);
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

function clearActiveRun() {
  activeRun = null;
  abortController = null;
}

app.get("/api/config", (_req, res) => {
  const settings = getSettings();
  res.json({
    defaults: {
      query: "digital marketing agency",
      location: "India",
      maxResults: 500,
      scrapeAll: true,
      proxyMode: true,
      headless: true,
    },
    built: buildGoogleSearchUrl({
      query: "digital marketing agency",
      location: "India",
    }),
    proxy: getProxyPublicConfig(),
    settings,
    defaultDownloadDir: getDefaultDownloadDir(),
  });
});

app.get("/api/settings", (_req, res) => {
  res.json(getSettings());
});

app.post("/api/settings", (req, res) => {
  const { downloadDir } = req.body ?? {};
  const saved = saveSettings({ downloadDir });
  res.json(saved);
});

app.get("/api/proxy/status", (_req, res) => {
  res.json(getProxyPublicConfig());
});

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
  if (abortController) abortController.abort();
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
    run.summary = buildRunSummary({
      status: run.status ?? "unknown",
      totalCollected: run.totalCollected ?? run.results?.length ?? 0,
      maxResults: run.filters?.maxResults,
      pagesScraped: run.pagesScraped ?? 0,
      error: run.error,
      filters: run.filters ?? {},
      block: run.block,
    });
  }

  res.json(run);
});

app.patch("/api/history/:id/remarks", (req, res) => {
  const { resultId, remarks } = req.body ?? {};
  if (!resultId) {
    res.status(400).json({ error: "resultId required" });
    return;
  }
  const updated = updateResultRemarks(req.params.id, resultId, remarks);
  if (!updated) {
    res.status(404).json({ error: "Run or result not found" });
    return;
  }
  res.json({ result: updated });
});

app.get("/api/export/csv", (req, res) => {
  const runId = req.query.runId;
  let results = [];

  if (runId) {
    const run = getExtractionRun(runId);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    results = run.results ?? [];
  } else if (req.query.live === "true" && activeRun?.results) {
    results = activeRun.results;
  } else {
    res.status(400).json({ error: "runId required" });
    return;
  }

  const csv = resultsToCsv(results);
  const filename = `google-search-${runId ?? "export"}.csv`;
  const settings = getSettings();

  try {
    mkdirSync(settings.downloadDir, { recursive: true });
    const filePath = join(settings.downloadDir, filename);
    writeFileSync(filePath, csv, "utf8");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Saved-Path", filePath);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: `Failed to save CSV: ${err.message}` });
  }
});

app.get("/api/extract/stream", async (req, res) => {
  if (activeRun) {
    res.status(409).json({
      error: "An extraction is already running",
      runId: activeRun.runId,
    });
    return;
  }

  const { query, location, maxResults, scrapeAll, filters, built } =
    parseExtractFilters(req.query);

  if (!query) {
    res.status(400).json({ error: "Search query is required" });
    return;
  }

  const headless = req.query.headless !== "false";
  const proxyMode =
    req.query.proxyMode !== "false" && req.query.proxy !== "false";

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
        hint: "Set WEBSHARE_API_KEY in .env",
        docs: getProxyPublicConfig().docs,
      });
      return;
    }
    try {
      const credentials = await resolveWebshareCredentials();
      const country =
        locationToCountryCode(location) ||
        null;
      proxyManager = createProxySessionManager({
        country,
        locationLabel: location || (country ? country.toUpperCase() : "Global"),
        credentials,
      });
      await proxyManager.init();
      proxyReport = { mode: "proxy", configured: true, ...proxyManager.buildReport() };
    } catch (proxyErr) {
      res.status(400).json({ error: proxyErr.message });
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

  activeRun = { runId, startedAt: Date.now(), results: [] };
  abortController = new AbortController();
  const signal = abortController.signal;

  const allResults = [];
  const activityLog = [];
  let runStatus = "running";
  let lastError = null;
  let pagesScraped = 0;
  let block = null;

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
      `Run started · "${query}" · ${proxyMode ? "Webshare proxy" : "local IP"} · ${scrapeAll ? "scrape to end" : `max ${maxResults}`}`,
      "success"
    );

    send("run-start", {
      runId,
      query,
      location,
      maxResults,
      scrapeAll,
      headless,
      proxyMode,
      proxyReport: proxyManager ? proxyManager.buildReport() : proxyReport,
      filters,
      built,
    });

    const handleCollectEvent = ({ type, ...data }) => {
      if (
        type === "proxy-rotation" ||
        type === "proxy-ip" ||
        type === "proxy-rotation-complete"
      ) {
        if (type === "proxy-rotation") pushLog(data.message, "info");
        if (type === "proxy-ip") {
          const ip = data.ipCheck;
          pushLog(
            `Proxy egress: ${ip?.ip ?? "?"} · ${ip?.city ?? "?"}, ${ip?.country ?? "?"}`,
            ip?.ok ? "success" : "warn"
          );
        }
        if (proxyManager) {
          proxyReport = proxyManager.buildReport();
          send("proxy-report", { proxyReport });
        }
        send(type, data);
      } else if (type === "progress") {
        allResults.push(data.result);
        activeRun.results = allResults;
        if (
          data.current === 1 ||
          data.current % 10 === 0 ||
          data.current === data.total
        ) {
          pushLog(
            `[${data.current}] ${data.result?.title ?? "?"}`,
            "success"
          );
        }
      } else if (type === "status") {
        pushLog(data.message, "info");
      } else if (type === "page-complete") {
        pagesScraped = data.page;
        pushLog(
          `Page ${data.page}: +${data.newOnPage} new (${data.total} total)`,
          "info"
        );
      } else if (type === "block") {
        block = data;
        pushLog(`Blocked: ${data.reasons?.join(", ")}`, "error");
        runStatus = "blocked";
      } else if (type === "plateau") {
        pushLog(data.message, "warn");
        if (runStatus === "running") runStatus = "plateau";
      } else if (type === "error") {
        pushLog(data.message ?? "Error", "error");
      }
      send(type, data);
    };

    const result = await collectGoogleResults({
      query,
      location,
      maxResults,
      scrapeAll,
      headless,
      signal,
      proxyManager,
      onEvent: handleCollectEvent,
    });

    pagesScraped = result.pagesScraped ?? pagesScraped;
    block = result.block ?? block;
    if (result.error) lastError = result.error;

    if (signal.aborted) {
      runStatus = runStatus === "running" ? "cancelled" : runStatus;
    } else if (runStatus === "blocked") {
      /* keep */
    } else if (scrapeAll && !block?.blocked && result.plateau) {
      runStatus = "completed";
    } else if (allResults.length >= maxResults && !scrapeAll) {
      runStatus = "completed";
    } else if (allResults.length > 0) {
      runStatus = runStatus === "plateau" ? "plateau" : "partial";
    } else {
      runStatus = "empty";
    }

    const withWebsite = allResults.filter((r) => r.hasWebsite).length;
    const withoutWebsite = allResults.length - withWebsite;

    const summary = buildRunSummary({
      status: runStatus,
      totalCollected: allResults.length,
      maxResults: scrapeAll ? allResults.length : maxResults,
      pagesScraped,
      error: lastError,
      filters,
      block,
    });
    summary.withWebsite = withWebsite;
    summary.withoutWebsite = withoutWebsite;

    pushLog(
      `${summary.title}: ${withWebsite} with website, ${withoutWebsite} without`,
      summary.outcome === "success" ? "success" : "warn"
    );

    if (proxyManager) {
      proxyReport = proxyManager.buildReport();
      send("proxy-summary", { proxyReport });
    }

    send("run-complete", {
      runId,
      totalCollected: allResults.length,
      results: allResults,
      status: runStatus,
      summary,
      proxyMode,
      proxyReport,
      pagesScraped,
      withWebsite,
      withoutWebsite,
    });
  } catch (err) {
    lastError = err.message;
    runStatus = "error";
    send("error", { message: err.message });
  } finally {
    clearInterval(heartbeat);

    const finishedAt = new Date().toISOString();
    const withWebsite = allResults.filter((r) => r.hasWebsite).length;
    const summary = buildRunSummary({
      status: runStatus,
      totalCollected: allResults.length,
      maxResults: scrapeAll ? allResults.length : maxResults,
      pagesScraped,
      error: lastError,
      filters,
      block,
    });
    summary.withWebsite = withWebsite;
    summary.withoutWebsite = allResults.length - withWebsite;

    try {
      saveExtractionRun({
        id: runId,
        startedAt,
        finishedAt,
        query,
        location,
        filters,
        built,
        headless,
        results: allResults,
        totalCollected: allResults.length,
        pagesScraped,
        status: runStatus,
        error: lastError,
        activityLog,
        block,
        summary,
        proxyMode,
        proxyReport: proxyManager ? proxyManager.buildReport() : proxyReport,
        stats: {
          withWebsite,
          withoutWebsite: allResults.length - withWebsite,
        },
      });
      send("history-saved", { runId, summary });
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
  console.log(`Google Search OS API → http://${HOST}:${PORT}`);
  if (!existsSync(dashboardDist)) {
    console.log(`Dashboard dev UI → npm run dashboard:dev (port 5174)`);
  }
});
