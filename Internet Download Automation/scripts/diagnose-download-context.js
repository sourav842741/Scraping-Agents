/** Test if download fails on fresh tab vs search tab */
import { launchBrowser, setupPage } from "../server/browser.js";

const URL = "https://i.pinimg.com/60x60/44/e4/61/44e4619a3d3f77962b567ff98dfb3c6f.jpg";
const REFERER = "https://www.pinterest.com/";

const browser = await launchBrowser({ headless: true });
const searchPage = await setupPage(await browser.newPage());
await searchPage.goto("https://www.pinterest.com/search/pins/?q=cookies", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 2000));

const freshPage = await setupPage(await browser.newPage());

async function testFetch(page, label) {
  const result = await page.evaluate(
    async ({ imageUrl, refererUrl }) => {
      try {
        const r = await fetch(imageUrl, {
          headers: refererUrl ? { Referer: refererUrl } : {},
          credentials: "omit",
        });
        return { ok: r.ok, status: r.status, ct: r.headers.get("content-type") };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    { imageUrl: URL, refererUrl: REFERER }
  );
  console.log(label, result);
}

await testFetch(searchPage, "search tab + referer:");
await testFetch(freshPage, "fresh tab + referer:");
await browser.close();
