import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { config } from "./config.js";
import { listJobs, getJobWithDetails, paths } from "./db.js";
import { enqueueJob, subscribe, cancelJob, getQueueStatus } from "./jobRunner.js";
import {
  getProxyPublicConfig,
  isProxyConfigured,
} from "../src/webshare-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    proxy: getProxyPublicConfig(),
    maxParallelJobs: config.maxParallelJobs,
    queue: getQueueStatus(),
  });
});

app.get("/api/queue", (_req, res) => {
  res.json(getQueueStatus());
});

app.get("/api/proxy/status", (_req, res) => {
  res.json(getProxyPublicConfig());
});

app.post("/api/jobs", (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  const location = String(req.body?.location ?? "").trim();
  const unlimited = Boolean(req.body?.unlimited);
  const proxyMode = Boolean(req.body?.proxyMode);
  const detailReport = req.body?.detailReport !== false;
  const maxResults = Math.min(
    1000,
    Math.max(1, Number(req.body?.maxResults ?? config.defaultMaxResults))
  );
  const maxRotations = Math.min(
    30,
    Math.max(1, Number(req.body?.maxRotations ?? config.defaultMaxRotations))
  );

  if (!query || query.length < 2) {
    return res.status(400).json({
      error: "Search query required",
      reason: "Enter at least 2 characters.",
    });
  }

  if (proxyMode && !isProxyConfigured()) {
    const proxy = getProxyPublicConfig();
    return res.status(400).json({
      error: "Proxy mode enabled but Webshare not configured",
      reason: proxy.envHint,
      docs: proxy.docs,
    });
  }

  const job = enqueueJob({
    query,
    location,
    unlimited,
    maxResults,
    maxRotations,
    proxyMode,
    detailReport,
  });
  res.status(201).json({ ...job, queue: getQueueStatus() });
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const result = cancelJob(req.params.id);
  if (!result.ok) {
    return res.status(400).json({ error: result.error, reason: result.error });
  }
  res.json(result);
});

app.get("/api/jobs", (_req, res) => {
  res.json(listJobs(100).map((j) => ({
    id: j.id,
    query: j.query,
    location: j.location,
    status: j.status,
    collected_count: j.collected_count,
    rotation_attempts: j.rotation_attempts,
    reject_count: j.reject_count,
    proxy_mode: Boolean(j.proxy_mode),
    unlimited: Boolean(j.unlimited),
    created_at: j.created_at,
    finished_at: j.finished_at,
  })));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

app.get("/api/jobs/:id/stream", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  for (const log of job.logs) {
    res.write(`data: ${JSON.stringify({ type: "log", log })}\n\n`);
  }
  if (job.places.length) {
    res.write(
      `data: ${JSON.stringify({
        type: "progress",
        collected_count: job.collected_count,
        scroll_rounds: job.scroll_rounds,
      })}\n\n`
    );
  }

  subscribe(req.params.id, res);

  if (["completed", "partial", "failed", "cancelled"].includes(job.status)) {
    res.write(`data: ${JSON.stringify({ type: "done", status: job.status })}\n\n`);
  }
});

app.get("/api/jobs/:id/export.csv", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job?.export_csv) {
    return res.status(404).json({ error: "Export not ready" });
  }
  const filePath = join(paths.exportsDir, job.export_csv);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "CSV file missing" });
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${job.export_csv}"`
  );
  res.send(readFileSync(filePath, "utf8"));
});

app.get("*", (_req, res) => {
  res.sendFile(join(ROOT, "public", "index.html"));
});

const HOST =
  process.env.HOST ??
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

app.listen(config.port, HOST, () => {
  console.log(`Google Maps Dashboard → http://${HOST}:${config.port}`);
});
