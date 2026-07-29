/**
 * Tests NodeMaven: API credentials resolve + one Puppeteer request via proxy.
 * Does not print secrets.
 */
import {
  loadProxyEnv,
  isProxyConfigured,
  resolveNodeMavenCredentials,
  buildNodeMavenUsername,
  createProxySessionManager,
  checkProxyEgress,
} from "../src/nodemaven-proxy.js";
import { launchBrowser, newPage } from "../src/browser.js";

loadProxyEnv();

async function main() {
  console.log("Proxy configured:", isProxyConfigured());
  if (!isProxyConfigured()) {
    console.error("FAIL: Set NODEMAVEN_API_KEY or proxy user/password in .env");
    process.exit(1);
  }

  console.log("Resolving credentials…");
  const creds = await resolveNodeMavenCredentials();
  console.log("  source:", creds.source);
  console.log("  user prefix:", creds.baseUser?.slice(0, 12) + "***");
  if (creds.account?.email) console.log("  account:", creds.account.email);
  if (creds.account?.isTrafficFrozen === true) {
    console.error("FAIL: Traffic frozen on account");
    process.exit(1);
  }

  const manager = createProxySessionManager({
    country: "in",
    locationLabel: "India (test)",
    credentials: creds,
  });
  const rot = manager.rotateForSite("test");
  console.log("  proxy gateway:", rot.proxyServer);
  console.log("  session user:", rot.entry.usernameMasked);

  console.log("Launching headless browser through proxy…");
  const browser = await launchBrowser({
    headless: true,
    proxyServer: rot.proxyServer,
  });
  const page = await newPage(browser, {
    proxyAuth: { username: rot.username, password: rot.password },
  });

  const ipCheck = await checkProxyEgress(page);
  manager.completeRotation(rot.entry, { ipCheck, scrapeJobs: 0, status: ipCheck.ok ? "ok" : "error" });

  await browser.close();

  console.log("  IP check OK:", ipCheck.ok);
  console.log("  egress IP:", ipCheck.ip ?? "—");
  console.log("  location:", [ipCheck.city, ipCheck.region, ipCheck.country].filter(Boolean).join(", ") || "—");
  console.log("  latency ms:", ipCheck.ms);
  if (ipCheck.error) console.log("  error:", ipCheck.error);

  if (!ipCheck.ok || !ipCheck.ip) {
    console.error("\nFAIL: Proxy tunnel did not return a valid egress IP");
    process.exit(1);
  }

  console.log("\nPASS: NodeMaven proxy is working");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
