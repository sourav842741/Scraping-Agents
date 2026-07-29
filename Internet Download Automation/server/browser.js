import puppeteer from "puppeteer";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launchBrowser({ headless = true, proxyServer } = {}) {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }
  return puppeteer.launch({ headless, args });
}

export async function setupPage(page, { proxyAuth } = {}) {
  if (proxyAuth?.username && proxyAuth?.password) {
    await page.authenticate({
      username: proxyAuth.username,
      password: proxyAuth.password,
    });
  }
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1400, height: 900 });
  return page;
}
