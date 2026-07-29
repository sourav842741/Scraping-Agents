import { mkdirSync, writeFileSync } from "fs";
import { launchBrowser, sleep } from "./browser.js";
import { loadConfig, parseCliArgs, paths } from "./config.js";
import { testIndeed } from "./scrapers/indeed.js";
import { testLinkedIn } from "./scrapers/linkedin.js";

async function main() {
  const { site } = parseCliArgs(process.argv.slice(2));
  const config = loadConfig();

  console.log("Job scraper research test (no login)");
  console.log(`  Site filter: ${site}`);
  console.log(`  Headless: ${config.headless}`);
  console.log(`  Delay between requests: ${config.requestDelayMs}ms`);
  console.log("");

  mkdirSync(paths.outputDir, { recursive: true });

  const browser = await launchBrowser({ headless: config.headless });
  const allResults = [];

  try {
    if (site === "all" || site === "linkedin") {
      console.log("--- LinkedIn ---");
      const linkedinResults = await testLinkedIn(browser, {
        urls: config.urls.linkedin ?? {},
        maxJobsFromSearch: config.maxJobsFromSearch,
        requestDelayMs: config.requestDelayMs,
      });
      printSummary(linkedinResults);
      allResults.push(...linkedinResults);
    }

    if (site === "all" || site === "indeed") {
      console.log("--- Indeed ---");
      const indeedResults = await testIndeed(browser, {
        urls: config.urls.indeed ?? {},
        maxJobsFromSearch: config.maxJobsFromSearch,
        requestDelayMs: config.requestDelayMs,
      });
      printSummary(indeedResults);
      allResults.push(...indeedResults);
    }
  } finally {
    await browser.close();
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = `${paths.outputDir}/results-${stamp}.json`;
  writeFileSync(outFile, JSON.stringify(allResults, null, 2));

  console.log("");
  console.log(`Full results written to: ${outFile}`);

  const anyOk = allResults.some((r) => r.ok);
  if (!anyOk) {
    console.log("");
    console.log(
      "No successful extractions. Try HEADLESS=false, add jobUrls from your browser, or check block reasons in the JSON."
    );
    process.exitCode = 1;
  }
}

function printSummary(results) {
  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    const block = r.block?.reasons?.length ? ` [block: ${r.block.reasons.join(", ")}]` : "";
    const count =
      r.jobs?.length != null
        ? ` jobs=${r.jobs.length}`
        : r.job?.title
          ? ` title="${r.job.title}"`
          : "";
    console.log(`  ${status} ${r.testType} ${r.url}${block}${count}`);
    if (r.hint) console.log(`       hint: ${r.hint}`);
    if (r.error) console.log(`       error: ${r.error}`);
    if (r.jobs?.length) {
      for (const j of r.jobs.slice(0, 3)) {
        console.log(`       - ${j.title ?? "(no title)"} @ ${j.company ?? "?"}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
