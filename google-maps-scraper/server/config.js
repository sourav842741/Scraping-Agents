import { loadProxyEnv } from "../src/webshare-proxy.js";

loadProxyEnv();

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  host:
    process.env.HOST ??
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  port: num("PORT", 3942),
  maxParallelJobs: num("MAX_PARALLEL_JOBS", 5),
  headless: process.env.HEADLESS !== "false",
  defaultMaxResults: num("DEFAULT_MAX_RESULTS", 100),
  defaultMaxRotations: num("DEFAULT_MAX_ROTATIONS", 15),
};
