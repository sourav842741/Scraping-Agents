import puppeteer from "puppeteer";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launchBrowser({ headless, proxyServer } = {}) {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  const browser = await puppeteer.launch({
    headless: headless ? "shell" : false,
    args,
    defaultViewport: { width: 1366, height: 900 },
  });

  return browser;
}

export async function newPage(browser, { proxyAuth } = {}) {
  const page = await browser.newPage();
  if (proxyAuth?.username && proxyAuth?.password) {
    await page.authenticate({
      username: proxyAuth.username,
      password: proxyAuth.password,
    });
  }
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  return page;
}

export async function goto(page, url, { timeout = 45000 } = {}) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout,
  });

  await sleep(2000);

  return {
    status: response?.status() ?? null,
    finalUrl: page.url(),
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
