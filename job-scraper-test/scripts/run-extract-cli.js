/**
 * CLI extract (no dashboard). Matches last failed run filters by default.
 * LinkedIn: proxy if configured · Indeed: proxy then auto local fallback on 403.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { collectJobs } from "../src/collect-jobs.js";
import { buildSearchUrls } from "../src/search-url-builder.js";
import {
  loadProxyEnv,
  isProxyConfigured,
  resolveNodeMavenCredentials,
  createProxySessionManager,
  locationToCountryCode,
} from "../src/nodemaven-proxy.js";
import { saveExtractionRun, makeRunId } from "../src/history-store.js";
import { buildRunSummary } from "../src/run-summary.js";

loadProxyEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

const filters = {
  keywords: "software engineer",
  location: "United States",
  postedWithin: "24h",
  sort: "date",
  linkedinWorkType: "any",
  indeedWorkType: "remote",
  linkedinExperience: "any",
  indeedExperience: "entry",
  indeedJobType: "any",
};

const quantity = 50;
const useProxy = isProxyConfigured();
const urls = buildSearchUrls(filters);

async function scrapeSite(site, searchUrl, proxyManager) {
  const jobs = [];
  const log = (msg) => console.log(`  ${msg}`);

  let result = await collectJobs({
    site,
    searchUrl,
    quantity,
    headless: true,
    proxyManager,
    onEvent: ({ type, message, httpStatus, reasons, current, total, job, collected, target }) => {
      if (type === "status" && message) log(message);
      if (type === "status" && httpStatus) log(`HTTP ${httpStatus}`);
      if (type === "block") log(`BLOCK: ${reasons?.join(", ")}`);
      if (type === "plateau") log(message ?? `plateau ${collected}/${target}`);
      if (type === "progress" && job) {
        jobs.push(job);
        if (current === 1 || current % 10 === 0) log(`[${current}/${total}] ${job.title}`);
      }
    },
  });

  if (
    site === "indeed" &&
    proxyManager &&
    (result.block?.reasons?.includes("http_403") || !result.jobs?.length)
  ) {
    console.log("  → Indeed 403 on proxy, retrying local IP…");
    result = await collectJobs({
      site,
      searchUrl,
      quantity,
      headless: true,
      proxyManager: null,
      onEvent: ({ type, message, reasons, current, total, job }) => {
        if (type === "status" && message) log(message);
        if (type === "block") log(`BLOCK: ${reasons?.join(", ")}`);
        if (type === "progress" && job) {
          jobs.push(job);
          if (current === 1 || current % 10 === 0) log(`[${current}/${total}] ${job.title}`);
        }
      },
    });
  }

  return result.jobs?.length ? result.jobs : jobs;
}

async function main() {
  const runId = makeRunId();
  const allJobs = [];
  const siteResults = {};

  let proxyManager = null;
  if (useProxy) {
    const creds = await resolveNodeMavenCredentials();
    proxyManager = createProxySessionManager({
      country: locationToCountryCode(filters.location) || "us",
      locationLabel: filters.location,
      credentials: creds,
    });
    console.log("Proxy: NodeMaven (LinkedIn). Indeed will fall back to local if 403.\n");
  } else {
    console.log("Proxy: off (local IP)\n");
  }

  for (const site of ["linkedin", "indeed"]) {
    const url = urls[site];
    console.log(`--- ${site} ---`);
    console.log(url);
    const jobs = await scrapeSite(
      site,
      url,
      site === "linkedin" ? proxyManager : proxyManager
    );
    for (const j of jobs) allJobs.push({ ...j, site });
    siteResults[site] = { site, ok: jobs.length > 0, count: jobs.length };
    console.log(`${site}: ${jobs.length} jobs\n`);
  }

  const summary = buildRunSummary({
    status: "partial",
    totalCollected: allJobs.length,
    quantity,
    sites: ["linkedin", "indeed"],
    siteResults,
    filters,
  });

  const record = {
    id: runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    sites: ["linkedin", "indeed"],
    quantity,
    filters,
    urls,
    jobs: allJobs,
    totalCollected: allJobs.length,
    status: summary.status,
    siteResults,
    summary,
    proxyMode: useProxy,
    proxyReport: proxyManager?.buildReport() ?? null,
  };

  saveExtractionRun(record);
  console.log("Summary:", summary.title);
  console.log(summary.diagnosis);
  console.log(`Saved: output/history/${runId}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
