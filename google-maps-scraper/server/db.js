import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const EXPORTS_DIR = join(ROOT, "output", "exports");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(EXPORTS_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "maps.sqlite"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    location TEXT,
    built_url TEXT,
    unlimited INTEGER DEFAULT 0,
    max_results INTEGER,
    max_rotations INTEGER DEFAULT 15,
    proxy_mode INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    collected_count INTEGER DEFAULT 0,
    scroll_rounds INTEGER DEFAULT 0,
    rotation_attempts INTEGER DEFAULT 0,
    reject_count INTEGER DEFAULT 0,
    failure_reason TEXT,
    proxy_report TEXT,
    export_csv TEXT,
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

  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    rating TEXT,
    review_count TEXT,
    address TEXT,
    phone TEXT,
    website TEXT,
    email TEXT,
    status TEXT,
    maps_url TEXT NOT NULL,
    scroll_round INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_logs_job ON activity_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_places_job ON places(job_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
`);

for (const col of ["website TEXT", "email TEXT"]) {
  try {
    db.exec(`ALTER TABLE places ADD COLUMN ${col}`);
  } catch {
    /* column exists */
  }
}

try {
  db.exec(`ALTER TABLE jobs ADD COLUMN detail_report INTEGER DEFAULT 1`);
} catch {
  /* column exists */
}

export const paths = { exportsDir: EXPORTS_DIR, dataDir: DATA_DIR };

export function createJob(row) {
  db.prepare(
    `INSERT INTO jobs (
      id, query, location, built_url, unlimited, max_results, max_rotations,
      proxy_mode, detail_report, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    row.id,
    row.query,
    row.location ?? "",
    row.builtUrl,
    row.unlimited ? 1 : 0,
    row.maxResults,
    row.maxRotations,
    row.proxyMode ? 1 : 0,
    row.detailReport ? 1 : 0,
    row.createdAt
  );
}

export function updateJob(id, patch) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (!fields.length) return;
  values.push(id);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function addLog(jobId, level, message, detail = null) {
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO activity_logs (job_id, level, message, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(jobId, level, message, detail, createdAt);
  return {
    id: Number(info.lastInsertRowid),
    job_id: jobId,
    level,
    message,
    detail,
    created_at: createdAt,
  };
}

export function addPlace(jobId, place) {
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO places (
        job_id, position, name, category, rating, review_count, address,
        phone, website, email, status, maps_url, scroll_round, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      jobId,
      place.position,
      place.name,
      place.category ?? "",
      place.rating ?? "",
      place.reviewCount ?? "",
      place.address ?? "",
      place.phone ?? "",
      place.website ?? "",
      place.email ?? "",
      place.status ?? "",
      place.mapsUrl,
      place.scrollRound ?? 0,
      createdAt
    );
  return { id: Number(info.lastInsertRowid), ...place, job_id: jobId, created_at: createdAt };
}

export function getJob(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

export function listJobs(limit = 100) {
  return db
    .prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

export function getPlaces(jobId) {
  return db
    .prepare(`SELECT * FROM places WHERE job_id = ? ORDER BY position ASC`)
    .all(jobId);
}

export function getLogs(jobId) {
  return db
    .prepare(`SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id ASC`)
    .all(jobId);
}

export function getJobWithDetails(id) {
  const job = getJob(id);
  if (!job) return null;
  return {
    ...serializeJob(job),
    logs: getLogs(id),
    places: getPlaces(id).map(serializePlace),
  };
}

function serializeJob(job) {
  return {
    id: job.id,
    query: job.query,
    location: job.location,
    built_url: job.built_url,
    unlimited: Boolean(job.unlimited),
    max_results: job.max_results,
    max_rotations: job.max_rotations,
    proxy_mode: Boolean(job.proxy_mode),
    detail_report:
      job.detail_report === undefined || job.detail_report === null
        ? true
        : Boolean(job.detail_report),
    status: job.status,
    collected_count: job.collected_count,
    scroll_rounds: job.scroll_rounds,
    rotation_attempts: job.rotation_attempts,
    reject_count: job.reject_count,
    failure_reason: job.failure_reason,
    proxy_report: job.proxy_report ? JSON.parse(job.proxy_report) : null,
    export_csv: job.export_csv,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

function serializePlace(row) {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    category: row.category,
    rating: row.rating,
    review_count: row.review_count,
    address: row.address,
    phone: row.phone,
    website: row.website ?? "",
    email: row.email ?? "",
    status: row.status,
    maps_url: row.maps_url,
    scroll_round: row.scroll_round,
    created_at: row.created_at,
  };
}
