/**
 * Google Maps business search CLI (proxy via NodeMaven, same pattern as job-scraper-test).
 *
 * Usage:
 *   node scripts/run-google-maps-cli.js --unlimited
 *   node scripts/run-google-maps-cli.js --query "dentist" --location "Mumbai" --max 50
 *   node scripts/run-google-maps-cli.js --no-proxy --headed --max 20
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { collectGoogleMapsBusinesses } from "../src/collect-google-maps.js";
import { parseMapsCliArgs } from "../src/maps-url-builder.js";
import { mapsResultsToCsv } from "../src/maps-csv-export.js";
import {
  loadProxyEnv,
  isProxyConfigured,
  resolveNodeMavenCredentials,
  createProxySessionManager,
  locationToCountryCode,
} from "../src/webshare-proxy.js";

loadProxyEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "output", "maps");

function printHelp() {
  console.log(`Google Maps business scraper

Options:
  -q, --query <text>       Search query (default: digital marketing agency)
  -l, --location <text>    Location bias (default: India)
  -m, --max <n>            Max businesses to collect (default: 100)
      --unlimited, --all   Scrape until list ends; rotate proxy on reject
      --scrolls <n>        Max scroll rounds per session (default: 50)
      --max-rotations <n>  Max proxy rotations on reject (default: 15)
      --no-proxy           Use local IP instead of NodeMaven
      --headed             Show browser window
  -h, --help               Show this help
`);
}

async function main() {
  const opts = parseMapsCliArgs();
  if (opts.help) {
    printHelp();
    return;
  }

  const useProxy = opts.proxy && isProxyConfigured();
  let proxyManager = null;

  console.log(`Query: ${opts.query}`);
  console.log(`Location: ${opts.location || "(none)"}`);
  console.log(`URL: ${opts.built}`);
  console.log(`Mode: ${opts.unlimited ? "unlimited (rotate on reject)" : `max ${opts.maxResults}`}`);
  console.log(`Max rotations: ${opts.maxRotations}`);
  console.log(`Proxy: ${useProxy ? "Webshare" : "local IP"}\n`);

  if (opts.proxy && !isProxyConfigured()) {
    console.error("Proxy requested but WEBSHARE_API_KEY is missing in .env");
    process.exit(1);
  }

  if (useProxy) {
    const creds = await resolveNodeMavenCredentials();
    proxyManager = createProxySessionManager({
      country: locationToCountryCode(opts.location) || "in",
      locationLabel: opts.location,
      credentials: creds,
    });
    await proxyManager.init();
  }

  const startedAt = new Date().toISOString();
  const rejectLog = [];
  const log = (msg) => console.log(`  ${msg}`);

  const result = await collectGoogleMapsBusinesses({
    query: opts.query,
    location: opts.location,
    maxResults: opts.maxResults,
    maxScrolls: opts.maxScrolls,
    unlimited: opts.unlimited,
    maxRotations: opts.maxRotations,
    headless: opts.headless,
    proxyManager,
    onEvent: (ev) => {
      const {
        type,
        message,
        ipCheck,
        scrollRound,
        newOnRound,
        total,
        current,
        result: item,
        reasons,
        rotationAttempts,
        collected,
        phase,
        error,
      } = ev;

      if (type === "proxy-rotation" && message) log(message);
      if (type === "proxy-ip" && ipCheck?.ok) {
        log(`Proxy egress: ${ipCheck.ip} · ${[ipCheck.city, ipCheck.country].filter(Boolean).join(", ")}`);
      }
      if (type === "rotation-resume" && message) log(message);
      if (type === "status" && message) log(message);
      if (type === "reject") {
        const line = `REJECT @ ${phase ?? "scroll"} round ${scrollRound ?? "?"}: ${reasons?.join(", ") ?? error ?? "unknown"} (${collected ?? 0} saved)`;
        rejectLog.push({ t: new Date().toISOString(), ...ev, line });
        log(line);
      }
      if (type === "block") log(`BLOCK: ${reasons?.join(", ")}`);
      if (type === "scroll-complete") log(`Scroll ${scrollRound}: +${newOnRound} new · total ${total}`);
      if (type === "plateau" && message) log(message);
      if (type === "progress" && item && (item.position === 1 || item.position % 25 === 0)) {
        log(`[${item.position}] ${item.name}`);
      }
      if (type === "error" && message) {
        log(`ERROR (rotation ${rotationAttempts ?? "?"}): ${message}`);
      }
    },
  });

  const finishedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, `${stamp}.json`);
  const csvPath = join(outDir, `${stamp}.csv`);

  const record = {
    startedAt,
    finishedAt,
    query: opts.query,
    location: opts.location,
    built: opts.built,
    unlimited: opts.unlimited,
    maxResults: opts.unlimited ? null : opts.maxResults,
    maxRotations: opts.maxRotations,
    proxyMode: useProxy,
    scrollRounds: result.scrollRounds,
    rotationAttempts: result.rotationAttempts,
    totalCollected: result.results.length,
    status: result.status,
    ok: result.ok,
    rejectLog,
    block: result.block,
    error: result.error,
    proxyReport: proxyManager?.buildReport() ?? null,
    results: result.results,
  };

  writeFileSync(jsonPath, JSON.stringify(record, null, 2), "utf8");
  writeFileSync(csvPath, mapsResultsToCsv(result.results), "utf8");

  console.log(`\nCollected: ${result.results.length} businesses (${result.scrollRounds} scroll rounds)`);
  console.log(`Rotations used: ${result.rotationAttempts}`);
  console.log(`Status: ${result.status}`);
  if (rejectLog.length) {
    console.log(`Rejects handled: ${rejectLog.length}`);
  }
  if (result.block?.blocked) {
    console.log(`Final block: ${result.block.reasons?.join(", ")}`);
  }
  if (result.error) console.log(`Final error: ${result.error}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
