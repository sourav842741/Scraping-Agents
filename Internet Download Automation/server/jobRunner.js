import { v4 as uuidv4 } from "uuid";
import {
  createJob,
  updateJob,
  addLog,
  addFile,
  addCandidates,
  getJobWithDetails,
  getJob,
  getCandidates,
  getCandidatesByIds,
  updateCandidate,
} from "./db.js";
import { runDownloadJob, runSelectedDownloads } from "./downloader.js";
import {
  isProxyConfigured,
  fetchProxyList,
  createProxySessionManager,
} from "./webshare-proxy.js";
import { createJobControl, JobCancelledError } from "./jobControl.js";
import { config } from "./config.js";

const listeners = new Map();
const queue = [];
const controls = new Map();
let activeCount = 0;

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
  count,
  sources,
  autoMode,
  proxyMode,
  parallelDownloads,
  snapshotMode,
  reviewMode,
}) {
  const id = uuidv4();
  const concurrency = Math.min(
    config.maxDownloadConcurrency,
    Math.max(1, Number(parallelDownloads ?? config.defaultDownloadConcurrency))
  );

  createJob({
    id,
    query,
    requestedCount: count,
    sources,
    autoMode,
    proxyMode,
    parallelDownloads: concurrency,
    snapshotMode,
    reviewMode,
  });

  const platformNote = autoMode ? "Auto (all platforms)" : sources.join(", ");
  const routeNote = proxyMode ? "Webshare proxy" : "local IP";
  const modeNote = snapshotMode
    ? `${count} scroll snapshot(s)/platform`
    : reviewMode
      ? `${count} URLs to preview (Review mode)`
      : `${count} images · ${concurrency} parallel`;
  log(id, "info", "Job queued", `Search: "${query}" · ${modeNote} · ${platformNote} · ${routeNote}`);

  controls.set(id, createJobControl(id));
  queue.push({
    id,
    query,
    count,
    sources,
    autoMode,
    proxyMode,
    parallelDownloads: concurrency,
    snapshotMode,
    reviewMode,
  });
  pumpQueue();
  return getJobWithDetails(id);
}

export function cancelJob(jobId) {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
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
    log(jobId, "warn", "Job cancelled", "Removed from queue before start");
    broadcast(jobId, { type: "done", status: "cancelled" });
    return { ok: true, status: "cancelled" };
  }

  if (job.status === "running") {
    const ctrl = controls.get(jobId);
    if (ctrl) {
      ctrl.cancel();
      log(jobId, "warn", "Stop requested", "Closing browsers and stopping downloads…");
    }
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

function makeProgressHandler(id) {
  return (p) => {
    if (p.found_count != null) {
      updateJob(id, { found_count: p.found_count });
      broadcast(id, { type: "progress", found_count: p.found_count });
    }
    if (p.success_count != null) {
      updateJob(id, {
        success_count: p.success_count,
        failed_count: p.failed_count,
      });
      broadcast(id, {
        type: "progress",
        success_count: p.success_count,
        failed_count: p.failed_count,
      });
    }
    if (p.candidates) {
      const rows = addCandidates(id, p.candidates);
      broadcast(id, { type: "candidates", candidates: rows });
    }
    if (p.file) {
      if (p.file.status === "success") {
        addFile({
          jobId: id,
          filename: p.file.filename,
          sourceUrl: p.file.sourceUrl,
          fileSize: p.file.fileSize,
          status: "success",
          sourcePlatform: p.file.sourcePlatform ?? null,
          fileKind: p.file.fileKind ?? "image",
        });
      } else {
        addFile({
          jobId: id,
          filename: `(failed)`,
          sourceUrl: p.file.sourceUrl,
          status: "failed",
          failureReason: p.file.failureReason,
        });
      }
      broadcast(id, { type: "file", file: p.file });
    }
    if (p.candidateUpdate) {
      updateCandidate(id, p.candidateUpdate.id, p.candidateUpdate.fields);
      broadcast(id, {
        type: "candidate",
        candidate: { id: p.candidateUpdate.id, ...p.candidateUpdate.fields },
      });
    }
  };
}

async function executeJob({
  id,
  query,
  count,
  sources,
  autoMode,
  proxyMode,
  parallelDownloads,
  snapshotMode,
  reviewMode,
}) {
  const ctrl = controls.get(id) ?? createJobControl(id);
  controls.set(id, ctrl);

  updateJob(id, {
    status: "running",
    started_at: new Date().toISOString(),
  });
  broadcast(id, { type: "status", status: "running" });
  log(
    id,
    "info",
    "Job started",
    `Headless browser for "${query}" · ${proxyMode ? "rotating Webshare proxy" : "local IP"} · ${parallelDownloads} parallel download(s)`
  );

  let proxyManager = null;

  try {
    ctrl.check();

    if (proxyMode) {
      if (!isProxyConfigured()) {
        throw new Error(
          "Proxy mode enabled but Webshare is not configured. Set WEBSHARE_API_KEY in .env"
        );
      }
      await fetchProxyList({ forceRefresh: true });
      proxyManager = createProxySessionManager();
      await proxyManager.init();
      log(id, "info", "Webshare proxies fetched");
    }

    const result = await runDownloadJob({
      jobId: id,
      query,
      count,
      sources,
      autoMode,
      proxyMode,
      proxyManager,
      parallelDownloads,
      snapshotMode,
      reviewMode,
      control: ctrl,
      onLog: (level, message, detail) => log(id, level, message, detail),
      onProgress: makeProgressHandler(id),
    });

    updateJob(id, {
      status: result.status,
      found_count: result.found_count,
      success_count: result.success_count,
      failed_count: result.failed_count,
      failure_reason: result.failure_reason,
      finished_at: result.status === "awaiting_review" ? null : new Date().toISOString(),
    });
    broadcast(id, {
      type: "done",
      status: result.status,
      result,
      proxyReport: result.proxyReport ?? null,
    });
  } catch (err) {
    if (err instanceof JobCancelledError || ctrl.isCancelled()) {
      const partial = getJob(id);
      updateJob(id, {
        status: "cancelled",
        failure_reason: `Stopped by user — ${partial?.success_count ?? 0} image(s) saved before cancel`,
        finished_at: new Date().toISOString(),
      });
      log(id, "warn", "Job stopped", partial?.success_count ? "Partial results kept" : "No images saved");
      broadcast(id, { type: "done", status: "cancelled" });
    } else {
      updateJob(id, {
        status: "failed",
        failure_reason: err.message,
        finished_at: new Date().toISOString(),
      });
      broadcast(id, { type: "done", status: "failed", error: err.message });
    }
  } finally {
    controls.delete(id);
  }
}

const downloadLocks = new Set();

export async function downloadSelected(jobId, candidateIds) {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: "Job not found" };
  if (!job.review_mode) {
    return { ok: false, error: "This job was not created in Review mode" };
  }
  if (downloadLocks.has(jobId)) {
    return { ok: false, error: "A download is already in progress for this job" };
  }

  const rows = getCandidatesByIds(jobId, candidateIds).filter(
    (c) => c.status === "pending" || c.status === "failed"
  );
  if (!rows.length) {
    return { ok: false, error: "No pending images selected (already downloaded or invalid)" };
  }

  downloadLocks.add(jobId);
  const ctrl = createJobControl(jobId);
  controls.set(jobId, ctrl);

  updateJob(jobId, { status: "running" });
  broadcast(jobId, { type: "status", status: "running" });
  log(jobId, "info", "Downloading selection", `${rows.length} image(s) picked from review`);

  let proxyManager = null;

  try {
    if (job.proxy_mode) {
      await fetchProxyList({ forceRefresh: true });
      proxyManager = createProxySessionManager();
      await proxyManager.init();
    }

    const items = rows.map((c) => ({
      url: c.url,
      platform: c.platform,
      referer: c.referer,
      downloadMethod: c.download_method,
      candidateId: c.id,
    }));

    const onProgress = makeProgressHandler(jobId);
    const wrappedProgress = (p) => {
      onProgress(p);
      if (p.file?.sourceUrl) {
        const row = rows.find((r) => r.url === p.file.sourceUrl);
        if (row) {
          const fields =
            p.file.status === "success"
              ? { status: "downloaded" }
              : { status: "failed", failure_reason: p.file.failureReason ?? "Download failed" };
          updateCandidate(jobId, row.id, fields);
          broadcast(jobId, { type: "candidate", candidate: { id: row.id, ...fields } });
        }
      }
    };

    const partial = getJob(jobId);
    const result = await runSelectedDownloads({
      jobId,
      items,
      proxyMode: Boolean(job.proxy_mode),
      proxyManager,
      parallelDownloads: job.parallel_downloads,
      successOffset: partial?.success_count ?? 0,
      control: ctrl,
      onLog: (level, message, detail) => log(jobId, level, message, detail),
      onProgress: wrappedProgress,
    });

    const pendingLeft = getCandidates(jobId).filter((c) => c.status === "pending").length;

    updateJob(jobId, {
      status:
        pendingLeft > 0
          ? "awaiting_review"
          : result.status === "failed"
            ? "partial"
            : "completed",
      success_count: result.success_count,
      failed_count: (partial?.failed_count ?? 0) + result.failed_count,
      failure_reason: result.failure_reason,
      finished_at: pendingLeft > 0 ? null : new Date().toISOString(),
    });
    broadcast(jobId, { type: "done", status: "completed" });
    return { ok: true, ...result };
  } catch (err) {
    updateJob(jobId, {
      status: "awaiting_review",
      failure_reason: err.message,
    });
    log(jobId, "error", "Selected download failed", err.message);
    return { ok: false, error: err.message };
  } finally {
    downloadLocks.delete(jobId);
    controls.delete(jobId);
  }
}
