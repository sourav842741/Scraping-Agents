import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export const paths = {
  root,
  testUrls: join(root, "test-urls.json"),
  outputDir: join(root, "output"),
};

export function loadConfig() {
  const delay = Number(process.env.REQUEST_DELAY_MS ?? 5000);
  const headless = process.env.HEADLESS !== "false";
  const maxJobsFromSearch = Number(process.env.MAX_JOBS_FROM_SEARCH ?? 5);

  let urls = { linkedin: {}, indeed: {} };
  try {
    urls = JSON.parse(readFileSync(paths.testUrls, "utf8"));
  } catch (err) {
    console.warn(`Could not read test-urls.json: ${err.message}`);
  }

  return {
    requestDelayMs: Number.isFinite(delay) ? delay : 5000,
    headless,
    maxJobsFromSearch: Number.isFinite(maxJobsFromSearch) ? maxJobsFromSearch : 5,
    urls,
  };
}

export function parseCliArgs(argv) {
  const siteIdx = argv.indexOf("--site");
  const site = siteIdx >= 0 ? argv[siteIdx + 1] : "all";
  if (!["all", "linkedin", "indeed"].includes(site)) {
    throw new Error(`Unknown --site value: ${site}. Use linkedin, indeed, or all.`);
  }
  return { site };
}
