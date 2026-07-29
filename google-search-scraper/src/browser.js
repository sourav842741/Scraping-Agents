import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteerExtra.use(StealthPlugin());

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const VIEWPORTS = [
  { width: 1366, height: 900 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1280, height: 800 },
];

const LANGUAGES = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "en-US,en;q=0.9,hi;q=0.8",
];

export async function launchBrowser({ headless, proxyServer } = {}) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-component-update",
  ];
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  const browser = await puppeteerExtra.launch({
    headless: headless ? "new" : false,
    args,
    defaultViewport: null,
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
  const ua = pick(USER_AGENTS);
  const vp = pick(VIEWPORTS);
  const lang = pick(LANGUAGES);

  await page.setUserAgent(ua);
  await page.setViewport(vp);
  await page.setExtraHTTPHeaders({
    "Accept-Language": lang,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
