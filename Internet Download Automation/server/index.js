import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { listJobs, getJobWithDetails, getCandidate, paths } from "./db.js";
import { enqueueJob, subscribe, cancelJob, downloadSelected } from "./jobRunner.js";
import { config, normalizeSources, ALL_PLATFORMS } from "./config.js";
import {
  getProxyPublicConfig,
  isProxyConfigured,
} from "./webshare-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = config.port;

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT, "public")));

app.get("/api/health", (_req, res) => {
  const proxy = getProxyPublicConfig();
  res.json({
    ok: true,
    time: new Date().toISOString(),
    platforms: ALL_PLATFORMS,
    proxy,
    maxParallelJobs: config.maxParallelJobs,
    maxDownloadConcurrency: config.maxDownloadConcurrency,
  });
});

app.get("/api/proxy/status", (_req, res) => {
  res.json(getProxyPublicConfig());
});

app.post("/api/jobs", (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  const count = Math.min(100, Math.max(1, Number(req.body?.count ?? 5)));

  if (!query || query.length < 2) {
    return res.status(400).json({
      error: "Search term required",
      reason: "Please enter at least 2 characters to search.",
    });
  }

  if (query.length > 200) {
    return res.status(400).json({
      error: "Search term too long",
      reason: "Maximum 200 characters allowed.",
    });
  }

  const autoMode = Boolean(req.body?.autoMode);
  const proxyMode = Boolean(req.body?.proxyMode);
  const sources = normalizeSources(req.body?.sources, autoMode);

  if (proxyMode && !isProxyConfigured()) {
    const proxy = getProxyPublicConfig();
    return res.status(400).json({
      error: "Proxy mode enabled but Webshare not configured",
      reason: proxy.envHint,
      docs: proxy.docs,
    });
  }

  const snapshotMode = Boolean(req.body?.snapshotMode);
  const reviewMode = Boolean(req.body?.reviewMode) && !snapshotMode;
  const parallelDownloads = Math.min(
    config.maxDownloadConcurrency,
    Math.max(1, Number(req.body?.parallelDownloads ?? config.defaultDownloadConcurrency))
  );

  const job = enqueueJob({
    query,
    count,
    sources,
    autoMode,
    proxyMode,
    parallelDownloads,
    snapshotMode,
    reviewMode,
  });
  res.status(201).json(job);
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const result = cancelJob(req.params.id);
  if (!result.ok) {
    return res.status(400).json({
      error: result.error,
      reason: result.error,
    });
  }
  res.json(result);
});

app.get("/api/jobs", (_req, res) => {
  const jobs = listJobs(100).map((j) => ({
    ...j,
    preview_count: j.success_count,
  }));
  res.json(jobs);
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) {
    return res.status(404).json({
      error: "Job not found",
      reason: "This download session does not exist or was removed.",
    });
  }
  res.json(job);
});

app.get("/api/jobs/:id/stream", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  for (const log of job.logs) {
    res.write(`data: ${JSON.stringify({ type: "log", log })}\n\n`);
  }
  res.write(
    `data: ${JSON.stringify({ type: "status", status: job.status })}\n\n`
  );

  subscribe(req.params.id, res);
});

app.get("/api/jobs/:id/candidates", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job.candidates ?? []);
});

app.post("/api/jobs/:id/download", async (req, res) => {
  const ids = Array.isArray(req.body?.candidateIds)
    ? req.body.candidateIds.map(Number).filter((n) => Number.isFinite(n))
    : [];
  if (!ids.length) {
    return res.status(400).json({
      error: "No candidates selected",
      reason: "Pick at least one image to download.",
    });
  }
  const result = await downloadSelected(req.params.id, ids);
  if (!result.ok) {
    return res.status(400).json({
      error: result.error,
      reason: result.error,
    });
  }
  res.json({ ...result, job: getJobWithDetails(req.params.id) });
});

app.get("/api/jobs/:jobId/candidates/:candidateId/preview", async (req, res) => {
  const candidate = getCandidate(req.params.jobId, Number(req.params.candidateId));
  if (!candidate) {
    return res.status(404).json({ error: "Candidate not found" });
  }

  try {
    const headers = candidate.referer ? { Referer: candidate.referer } : {};
    const response = await fetch(candidate.url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(config.downloadTimeoutMs ?? 20000),
    });
    if (!response.ok) {
      return res.status(502).json({ error: `Preview failed: HTTP ${response.status}` });
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length < 256) {
      return res.status(502).json({ error: "Preview too small or blocked" });
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: err.message || "Preview failed" });
  }
});

app.get("/api/files/:jobId/:filename", (req, res) => {
  const { jobId, filename } = req.params;
  if (!/^[\w.-]+$/.test(filename) || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  const filePath = join(paths.storage, jobId, filename);
  if (!existsSync(filePath)) {
    return res.status(404).json({
      error: "File not found",
      reason: "Image may have failed to download or was deleted.",
    });
  }
  res.sendFile(filePath);
});

app.get("*", (_req, res) => {
  res.sendFile(join(ROOT, "public", "index.html"));
});

app.listen(PORT, config.host, () => {
  const proxy = isProxyConfigured() ? "Webshare ready" : "local IP only";
  console.log(`\n  Download Dashboard → http://${config.host}:${PORT}  (${proxy})\n`);
});
