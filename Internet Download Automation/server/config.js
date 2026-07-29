import { loadProxyEnv } from "./nodemaven-proxy.js";

loadProxyEnv();

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const ALL_PLATFORMS = [
  "bing",
  "duckduckgo",
  "pinterest",
  "unsplash",
  "pixabay",
];

export const config = {
  host:
    process.env.HOST ??
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  port: num("PORT", 3939),
  maxParallelJobs: num("MAX_PARALLEL_JOBS", 3),
  defaultDownloadConcurrency: num("DEFAULT_DOWNLOAD_CONCURRENCY", 3),
  maxDownloadConcurrency: num("MAX_DOWNLOAD_CONCURRENCY", 5),
  downloadDelayMs: num("DOWNLOAD_DELAY_MS", 800),
  searchDelayMs: num("SEARCH_DELAY_MS", 1200),
  retryCount: num("RETRY_COUNT", 3),
  retryBackoffMs: num("RETRY_BACKOFF_MS", 1500),
  downloadTimeoutMs: num("DOWNLOAD_TIMEOUT_MS", 30000),
  maxFileBytes: num("MAX_FILE_BYTES", 15 * 1024 * 1024),
  headless: process.env.HEADLESS !== "false",
};

export function normalizeSources(input, autoMode) {
  if (autoMode) return [...ALL_PLATFORMS];
  const list = Array.isArray(input) ? input : [];
  const picked = list.filter((p) => ALL_PLATFORMS.includes(p));
  return picked.length ? picked : ["bing", "duckduckgo"];
}
