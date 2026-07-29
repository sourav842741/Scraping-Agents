import { v4 as uuidv4 } from "uuid";
import { writeFileSync } from "fs";
import { join } from "path";
import { collectGoogleMapsBusinesses } from "../src/collect-google-maps.js";
import { buildGoogleMapsSearchUrl } from "../src/maps-url-builder.js";
import { mapsResultsToCsv } from "../src/maps-csv-export.js";
import {
  isProxyConfigured,
  resolveWebshareCredentials,
  createProxySessionManager,
  locationToCountryCode,
} from "../src/webshare-proxy.js";
import {
  createJob,
  updateJob,
  addLog,
  addPlace,
  getJob,
  getJobWithDetails,
  listJobs,
  paths,
} from "./db.js";
import { createJobControl, JobCancelledError } from "./jobControl.js";
import { config } from "./config.js";

const listeners = new Map();
const queue = [];
const controls = new Map();
let activeCount = 0;

function recoverStaleJobs() {
  const stale = listJobs(200).filter((j) =>
    ["pending", "running"].includes(j.status)
  );
  for (const j of stale) {
    updateJob(j.id, {
      status: "cancelled",
      failure_reason: "Interrupted — server restarted or queue cleared",
      finished_at: new Date().toISOString(),
    });
    addLog(j.id, "warn", "Job cancelled", "Stale job cleared on server start");
  }
}

recoverStaleJobs();

export function getQueueStatus() {
  const maxParallel = config.maxParallelJobs;
  const running = activeCount;
  const waiting = queue.length;
  return {
    running,
    waiting,
    maxParallel,
    activeCount: running,
    queued: waiting,
    busy: running > 0 || waiting > 0,
    label:
      waiting > 0
        ? `${running} of ${maxParallel} running · ${waiting} waiting`
        : running > 0
          ? `${running} of ${maxParallel} running`
          : null,
  };
}

export function subscribe(jobId, res) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(res);
  res.on("close", () => listeners.get(jobId)?.delete(res));
}

function broadcast(jobId, payload) {
  const set = listeners.get(jobId);
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
      /* client gone */
    }
  }
}

function log(jobId, level, message, detail = null) {
  const row = addLog(jobId, level, message, detail);
  broadcast(jobId, { type: "log", log: row });
}

export function enqueueJob({
  query,
  location,
  unlimited,
  maxResults,
  maxRotations,
  proxyMode,
  detailReport = true,
}) {
  const id = uuidv4();
  const builtUrl = buildGoogleMapsSearchUrl({ query, location });
  const createdAt = new Date().toISOString();

  createJob({
    id,
    query,
    location,
    builtUrl,
    unlimited,
    maxResults: unlimited ? null : maxResults,
    maxRotations,
    proxyMode,
    detailReport,
    createdAt,
  });

  const routeNote = proxyMode ? "Webshare proxy" : "local IP";
  const modeNote = unlimited ? "unlimited · rotate on reject" : `max ${maxResults}`;
  const reportNote = detailReport ? "detail report" : "fast report";
  log(
    id,
    "info",
    "Job queued",
    `"${query}"${location ? ` · ${location}` : ""} · ${modeNote} · ${reportNote} · ${routeNote}`
  );

  controls.set(id, createJobControl());
  queue.push({
    id,
    query,
    location,
    unlimited,
    maxResults,
    maxRotations,
    proxyMode,
    detailReport,
  });

  const maxParallel = config.maxParallelJobs;
  const jobsAhead = activeCount + queue.length - 1;
  if (jobsAhead >= maxParallel) {
    const waitSlot = jobsAhead - maxParallel + 1;
    log(
      id,
      "info",
      "Waiting in queue",
      `${waitSlot} ahead in line · up to ${maxParallel} scrapes run in parallel`
    );
  }

  pumpQueue();
  return getJobWithDetails(id);
}

export function cancelJob(jobId) {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };

  if (["completed", "failed", "cancelled", "partial"].includes(job.status)) {
    return { ok: false, error: `Job already ${job.status}` };
  }

  if (job.status === "pending") {
    const idx = queue.findIndex((j) => j.id === jobId);
    if (idx >= 0) queue.splice(idx, 1);
    controls.get(jobId)?.cancel();
    controls.delete(jobId);
    updateJob(jobId, {
      status: "cancelled",
      failure_reason: "Cancelled before start",
      finished_at: new Date().toISOString(),
    });
    log(jobId, "warn", "Job cancelled", "Removed from queue");
    broadcast(jobId, { type: "done", status: "cancelled" });
    return { ok: true, status: "cancelled" };
  }

  if (job.status === "running") {
    controls.get(jobId)?.cancel();
    log(jobId, "warn", "Stop requested", "Closing browser…");
    return { ok: true, status: "stopping" };
  }

  return { ok: false, error: "Job cannot be cancelled" };
}

function pumpQueue() {
  while (activeCount < config.maxParallelJobs && queue.length) {
    const job = queue.shift();
    activeCount += 1;
    executeJob(job).finally(() => {
      activeCount -= 1;
      pumpQueue();
    });
  }
}

async function executeJob(job) {
  const {
    id,
    query,
    location,
    unlimited,
    maxResults,
    maxRotations,
    proxyMode,
    detailReport = true,
  } = job;
  const control = controls.get(id);
  const rejectCount = { n: 0 };
  const savedUrls = new Set();

  updateJob(id, {
    status: "running",
    started_at: new Date().toISOString(),
  });
  const reportDetail = detailReport
    ? "Detail report — visits each place for website, phone & email"
    : "Fast report — list feed only (no website/email; phone if shown in list)";
  log(id, "info", "Scrape started", reportDetail);
  broadcast(id, { type: "status", status: "running" });

  let proxyManager = null;
  if (proxyMode) {
    try {
      const creds = await resolveWebshareCredentials();
      proxyManager = createProxySessionManager({
        country: locationToCountryCode(location) || "in",
        locationLabel: location || "India",
        credentials: creds,
      });
      await proxyManager.init();
    } catch (err) {
      updateJob(id, {
        status: "failed",
        failure_reason: err.message,
        finished_at: new Date().toISOString(),
      });
      log(id, "error", "Proxy setup failed", err.message);
      broadcast(id, { type: "done", status: "failed" });
      controls.delete(id);
      return;
    }
  }

  try {
    const result = await collectGoogleMapsBusinesses({
      query,
      location,
      maxResults: unlimited ? 10000 : maxResults,
      maxScrolls: unlimited ? 500 : 50,
      unlimited,
      maxRotations,
      enrichDetails: detailReport,
      headless: config.headless,
      signal: control?.signal,
      proxyManager,
      onEvent: (ev) => {
        control?.check();

        if (ev.type === "proxy-rotation" && ev.message) {
          log(id, "info", ev.message);
        }
        if (ev.type === "proxy-ip" && ev.ipCheck?.ok) {
          log(
            id,
            "success",
            `Proxy egress: ${ev.ipCheck.ip}`,
            [ev.ipCheck.city, ev.ipCheck.country].filter(Boolean).join(", ")
          );
        }
        if (ev.type === "rotation-resume" && ev.message) {
          log(id, "info", ev.message);
        }
        if (ev.type === "status" && ev.message) {
          log(id, "info", ev.message);
        }
        if (ev.type === "reject") {
          rejectCount.n += 1;
          const detail = ev.reasons?.join(", ") ?? ev.error ?? "rejected";
          log(id, "error", `REJECT: ${detail}`, `${ev.collected ?? 0} saved so far`);
          broadcast(id, {
            type: "reject",
            reasons: ev.reasons,
            collected: ev.collected,
          });
          updateJob(id, { reject_count: rejectCount.n });
        }
        if (ev.type === "scroll-complete") {
          updateJob(id, {
            collected_count: ev.total ?? 0,
            scroll_rounds: ev.scrollRound ?? 0,
          });
          broadcast(id, {
            type: "progress",
            collected_count: ev.total,
            scroll_rounds: ev.scrollRound,
            new_on_round: ev.newOnRound,
          });
        }
        if (ev.type === "progress" && ev.result) {
          const place = ev.result;
          if (!savedUrls.has(place.mapsUrl)) {
            savedUrls.add(place.mapsUrl);
            const row = addPlace(id, {
              position: place.position,
              name: place.name,
              category: place.category,
              rating: place.rating,
              reviewCount: place.reviewCount,
              address: place.address,
              phone: place.phone,
              website: place.website,
              email: place.email,
              status: place.status,
              mapsUrl: place.mapsUrl,
              scrollRound: place.scrollRound,
            });
            updateJob(id, { collected_count: ev.current });
            broadcast(id, {
              type: "place",
              place: {
                id: row.id,
                position: place.position,
                name: place.name,
                category: place.category,
                rating: place.rating,
                phone: place.phone,
                website: place.website ?? "",
                email: place.email ?? "",
                address: place.address,
                maps_url: place.mapsUrl,
              },
            });
          }
        }
        if (ev.type === "plateau" && ev.message) {
          log(id, "info", ev.message);
        }
        if (ev.type === "error" && ev.message) {
          log(id, "error", ev.message);
        }
      },
    });

    const status =
      result.ok && result.status === "ok"
        ? "completed"
        : result.ok
          ? "partial"
          : control?.isCancelled()
            ? "cancelled"
            : "failed";

    const csvName = `maps-${id}.csv`;
    const csvPath = join(paths.exportsDir, csvName);
    writeFileSync(csvPath, mapsResultsToCsv(result.results), "utf8");

    updateJob(id, {
      status,
      collected_count: result.results.length,
      scroll_rounds: result.scrollRounds,
      rotation_attempts: result.rotationAttempts,
      reject_count: rejectCount.n,
      failure_reason: result.error ?? (result.block?.reasons?.join(", ") || null),
      proxy_report: proxyManager ? JSON.stringify(proxyManager.buildReport()) : null,
      export_csv: csvName,
      finished_at: new Date().toISOString(),
    });

    log(
      id,
      status === "completed" ? "success" : status === "partial" ? "warn" : "error",
      `Finished: ${result.results.length} places · ${result.rotationAttempts} rotation(s)`,
      rejectCount.n ? `${rejectCount.n} reject(s) handled` : null
    );

    broadcast(id, {
      type: "done",
      status,
      collected_count: result.results.length,
      rotation_attempts: result.rotationAttempts,
      reject_count: rejectCount.n,
      export_csv: csvName,
      proxyReport: proxyManager?.buildReport() ?? null,
    });
  } catch (err) {
    if (err instanceof JobCancelledError) {
      updateJob(id, {
        status: "cancelled",
        failure_reason: "Cancelled by user",
        finished_at: new Date().toISOString(),
      });
      log(id, "warn", "Job cancelled");
      broadcast(id, { type: "done", status: "cancelled" });
    } else {
      updateJob(id, {
        status: "failed",
        failure_reason: err.message,
        finished_at: new Date().toISOString(),
      });
      log(id, "error", "Job failed", err.message);
      broadcast(id, { type: "done", status: "failed" });
    }
  } finally {
    controls.delete(id);
  }
}
