/**
 * Diagnose Indeed 0-job runs: test URL variants, local vs proxy, proxy filters.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildIndeedSearchUrl } from "../src/search-url-builder.js";
import { collectJobs } from "../src/collect-jobs.js";
import {
  loadProxyEnv,
  resolveNodeMavenCredentials,
  createProxySessionManager,
} from "../src/nodemaven-proxy.js";

loadProxyEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "output", "indeed-diagnostics");

const baseFilters = {
  keywords: "software engineer",
  location: "United States",
  postedWithin: "24h",
  workType: "remote",
  experience: "entry",
  sort: "date",
  jobType: "any",
};

const variants = [
  {
    id: "fixed-url-no-remote-filter",
    label: "Indeed US · no remote sc filter (fixed encoding)",
    url: "https://www.indeed.com/jobs?q=software+engineer&l=United+States&fromage=1&sort=date&explvl=entry_level",
    proxy: null,
  },
  {
    id: "built-url-local",
    label: "Built URL · local IP",
    url: buildIndeedSearchUrl(baseFilters),
    proxy: null,
  },
  {
    id: "built-url-proxy-medium",
    label: "Built URL · proxy US medium",
    url: buildIndeedSearchUrl(baseFilters),
    proxy: { country: "us", filter: "medium" },
  },
  {
    id: "simple-url-proxy",
    label: "Simple query · proxy US (no explvl)",
    url: "https://www.indeed.com/jobs?q=software+engineer&l=United+States&fromage=1",
    proxy: { country: "us", filter: "medium" },
  },
  {
    id: "simple-url-proxy-high",
    label: "Simple query · proxy US filter=high",
    url: "https://www.indeed.com/jobs?q=software+engineer&l=United+States&fromage=1",
    proxy: { country: "us", filter: "high" },
  },
  {
    id: "built-url-local-headful",
    label: "Built URL · local · visible browser",
    url: buildIndeedSearchUrl(baseFilters),
    proxy: null,
    headless: false,
  },
];

async function runVariant(v) {
  let proxyManager = null;
  if (v.proxy) {
    const credentials = await resolveNodeMavenCredentials();
    process.env.NODEMAVEN_PROXY_FILTER = v.proxy.filter;
    proxyManager = createProxySessionManager({
      country: v.proxy.country,
      locationLabel: "United States",
      credentials,
    });
  }

  const events = [];
  const result = await collectJobs({
    site: "indeed",
    searchUrl: v.url,
    quantity: 40,
    headless: v.headless !== false,
    proxyManager,
    onEvent: (e) => events.push(e),
  });

  const httpStatus =
    events.find((e) => e.type === "status" && e.phase === "loaded")?.httpStatus ?? null;
  const block = events.find((e) => e.type === "block");
  const plateau = events.find((e) => e.type === "plateau");

  return {
    id: v.id,
    label: v.label,
    url: v.url,
    proxy: v.proxy,
    httpStatus,
    block: block?.reasons ?? null,
    plateau: plateau?.message ?? null,
    count: result.jobs?.length ?? 0,
    sample: (result.jobs ?? []).slice(0, 3).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
    })),
    ok: result.ok,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log("Indeed diagnostics — last run failed with HTTP 403 via proxy\n");

  const results = [];
  for (const v of variants) {
    console.log(`\n▶ ${v.label}`);
    console.log(`  ${v.url.slice(0, 90)}…`);
    try {
      const r = await runVariant(v);
      results.push(r);
      console.log(`  HTTP ${r.httpStatus ?? "?"} · jobs: ${r.count} · block: ${r.block?.join(", ") ?? "no"}`);
      if (r.sample[0]) console.log(`  sample: ${r.sample[0].title} @ ${r.sample[0].company}`);
    } catch (err) {
      results.push({ id: v.id, label: v.label, error: err.message });
      console.log(`  ERROR: ${err.message}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `diagnostic-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved: ${outFile}`);

  const best = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count)[0];
  if (best) {
    console.log(`\nBest: ${best.label} → ${best.count} jobs (HTTP ${best.httpStatus})`);
  } else {
    console.log("\nNo variant returned jobs — Indeed may be blocking all tested paths.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
