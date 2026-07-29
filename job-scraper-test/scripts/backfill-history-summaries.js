import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildRunSummary } from "../src/run-summary.js";

const historyDir = join(dirname(fileURLToPath(import.meta.url)), "..", "output", "history");

for (const file of readdirSync(historyDir).filter((f) => f.endsWith(".json"))) {
  const path = join(historyDir, file);
  const run = JSON.parse(readFileSync(path, "utf8"));
  if (run.summary) continue;

  const linkedinCount = (run.jobs ?? []).filter((j) => j.site === "linkedin").length;
  const indeedCount = (run.jobs ?? []).filter((j) => j.site === "indeed").length;
  const siteResults = {};
  for (const site of run.sites ?? []) {
    const c = site === "linkedin" ? linkedinCount : indeedCount;
    siteResults[site] = { site, ok: c > 0, count: c };
  }

  let status = run.status ?? "unknown";
  const target = (run.quantity ?? 0) * (run.sites?.length ?? 1);
  if (status === "completed" && (run.totalCollected ?? 0) < target * 0.9) {
    status = "partial";
  }

  run.summary = buildRunSummary({
    status,
    totalCollected: run.totalCollected,
    quantity: run.quantity,
    sites: run.sites,
    siteResults,
    error: run.error,
    filters: run.filters,
  });

  run.status = status;
  writeFileSync(path, JSON.stringify(run, null, 2));
  console.log(`Updated ${file} → ${run.summary.title} (${run.totalCollected}/${target})`);
}
