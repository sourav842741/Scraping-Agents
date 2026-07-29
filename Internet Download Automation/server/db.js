import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

mkdirSync(DATA_DIR, { recursive: true });

import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(join(DATA_DIR, "dashboard.sqlite"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    requested_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    found_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS downloaded_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    source_url TEXT,
    file_size INTEGER,
    status TEXT NOT NULL,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_logs_job ON activity_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_files_job ON downloaded_files(job_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
`);

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN sources TEXT`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN auto_mode INTEGER DEFAULT 0`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN proxy_mode INTEGER DEFAULT 0`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN parallel_downloads INTEGER DEFAULT 1`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN snapshot_mode INTEGER DEFAULT 0`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE downloaded_files ADD COLUMN source_platform TEXT`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE downloaded_files ADD COLUMN file_kind TEXT DEFAULT 'image'`);
} catch {
  /* column exists */
}

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN review_mode INTEGER DEFAULT 0`);
} catch {
  /* column exists */
}

db.exec(`
  CREATE TABLE IF NOT EXISTS job_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    url TEXT NOT NULL,
    platform TEXT NOT NULL,
    referer TEXT,
    download_method TEXT DEFAULT 'fetch',
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );
  CREATE INDEX IF NOT EXISTS idx_candidates_job ON job_candidates(job_id);
`);

export function addCandidates(jobId, items) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO job_candidates
     (job_id, url, platform, referer, download_method, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  );
  db.exec("BEGIN");
  try {
    for (const item of items) {
      stmt.run(
        jobId,
        item.url,
        item.platform,
        item.referer ?? null,
        item.downloadMethod ?? "fetch",
        now
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return getCandidates(jobId);
}

export function getCandidates(jobId) {
  return db
    .prepare(
      `SELECT * FROM job_candidates WHERE job_id = ? ORDER BY id ASC`
    )
    .all(jobId);
}

export function getCandidate(jobId, candidateId) {
  return db
    .prepare(`SELECT * FROM job_candidates WHERE job_id = ? AND id = ?`)
    .get(jobId, candidateId);
}

export function getCandidatesByIds(jobId, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM job_candidates WHERE job_id = ? AND id IN (${placeholders})`
    )
    .all(jobId, ...ids);
}

export function updateCandidate(jobId, candidateId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE job_candidates SET ${sets} WHERE job_id = ? AND id = ?`).run(
    ...keys.map((k) => fields[k]),
    jobId,
    candidateId
  );
}

export function createJob({
  id,
  query,
  requestedCount,
  sources,
  autoMode,
  proxyMode,
  parallelDownloads,
  snapshotMode,
  reviewMode,
}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (id, query, requested_count, status, sources, auto_mode, proxy_mode, parallel_downloads, snapshot_mode, review_mode, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    query,
    requestedCount,
    JSON.stringify(sources ?? []),
    autoMode ? 1 : 0,
    proxyMode ? 1 : 0,
    parallelDownloads ?? 1,
    snapshotMode ? 1 : 0,
    reviewMode ? 1 : 0,
    now
  );
  return getJob(id);
}

export function updateJob(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE jobs SET ${sets} WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    id
  );
}

export function getJob(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

export function listJobs(limit = 50) {
  return db
    .prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

export function addLog(jobId, level, message, detail = null) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_logs (job_id, level, message, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(jobId, level, message, detail, now);
  return db
    .prepare(`SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id DESC LIMIT 1`)
    .get(jobId);
}

export function getLogs(jobId) {
  return db
    .prepare(`SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id ASC`)
    .all(jobId);
}

export function addFile(record) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO downloaded_files
     (job_id, filename, source_url, file_size, status, failure_reason, source_platform, file_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.jobId,
    record.filename,
    record.sourceUrl ?? null,
    record.fileSize ?? null,
    record.status,
    record.failureReason ?? null,
    record.sourcePlatform ?? null,
    record.fileKind ?? "image",
    now
  );
}

export function getFiles(jobId) {
  return db
    .prepare(
      `SELECT * FROM downloaded_files WHERE job_id = ? ORDER BY id ASC`
    )
    .all(jobId);
}

function parseJob(job) {
  if (!job) return null;
  let sources = [];
  try {
    sources = JSON.parse(job.sources || "[]");
  } catch {
    sources = [];
  }
  return {
    ...job,
    sources,
    auto_mode: Boolean(job.auto_mode),
    proxy_mode: Boolean(job.proxy_mode),
    snapshot_mode: Boolean(job.snapshot_mode),
    review_mode: Boolean(job.review_mode),
  };
}

export function getJobWithDetails(id) {
  const job = getJob(id);
  if (!job) return null;
  return {
    ...parseJob(job),
    logs: getLogs(id),
    files: getFiles(id),
    candidates: getCandidates(id),
  };
}

export const paths = {
  root: ROOT,
  storage: join(ROOT, "storage", "downloads"),
};
