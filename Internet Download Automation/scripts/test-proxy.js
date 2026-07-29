/**
 * Tests NodeMaven: credentials resolve + one Puppeteer request via proxy.
 * Run: node scripts/test-proxy.js
 */
import { launchBrowser, setupPage } from "../server/browser.js";
import {
  loadProxyEnv,
  isProxyConfigured,
  resolveNodeMavenCredentials,
  createProxySessionManager,
  checkProxyEgress,
} from "../server/nodemaven-proxy.js";

loadProxyEnv();

async function main() {
  console.log("Proxy configured:", isProxyConfigured());
  if (!isProxyConfigured()) {
    console.error("FAIL: Set NODEMAVEN_API_KEY in .env");
    process.exit(1);
  }

  const creds = await resolveNodeMavenCredentials();
  console.log("Credentials source:", creds.source);

  const manager = createProxySessionManager({ credentials: creds });
  const rot = manager.rotateForPlatform("test");
  console.log("Rotation:", rot.entry.usernameMasked);
  console.log("Gateway:", rot.proxyServer);

  const browser = await launchBrowser({ headless: true, proxyServer: rot.proxyServer });
  const page = await setupPage(await browser.newPage(), {
    proxyAuth: { username: rot.username, password: rot.password },
  });

  const ipCheck = await checkProxyEgress(page);
  await browser.close();

  if (ipCheck.ok) {
    console.log(`PASS: egress ${ipCheck.ip} (${ipCheck.city}, ${ipCheck.country})`);
  } else {
    console.error("FAIL:", ipCheck.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
