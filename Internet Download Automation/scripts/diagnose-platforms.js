/**
 * Diagnose why non-Bing platforms fail. Run: node scripts/diagnose-platforms.js
 */
import { launchBrowser, setupPage } from "../server/browser.js";
import { loadProxyEnv } from "../server/nodemaven-proxy.js";

loadProxyEnv();

const QUERY = process.argv[2] || "cookies";

const PLATFORMS = {
  duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(QUERY)}&iax=images&ia=images`,
  pinterest: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(QUERY)}`,
  unsplash: `https://unsplash.com/s/photos/${encodeURIComponent(QUERY)}`,
  pixabay: `https://pixabay.com/images/search/${encodeURIComponent(QUERY)}/`,
  bing: `https://www.bing.com/images/search?q=${encodeURIComponent(QUERY)}&form=HDRSC2`,
};

async function diagnose(name, url) {
  const browser = await launchBrowser({ headless: true });
  const page = await setupPage(await browser.newPage());

  const result = { platform: name, url, error: null };

  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));

    result.httpStatus = res?.status();
    result.finalUrl = page.url();
    result.title = await page.title();

    result.signals = await page.evaluate(() => {
      const text = document.body?.innerText?.slice(0, 500) ?? "";
      return {
        hasCaptcha: /captcha|unusual traffic|not a robot|consent/i.test(text),
        hasLoginWall: /sign in|log in|create account/i.test(text),
        imgCount: document.querySelectorAll("img").length,
        aWithImgurl: document.querySelectorAll('a[href*="imgurl="]').length,
        bingIusc: document.querySelectorAll("a.iusc").length,
        ddgTiles: document.querySelectorAll("[data-testid='tile']").length,
        pinimgCount: [...document.querySelectorAll("img")].filter((i) =>
          (i.src || "").includes("pinimg.com")
        ).length,
        unsplashCount: [...document.querySelectorAll("img")].filter((i) =>
          (i.src || "").includes("unsplash.com")
        ).length,
        sampleImgSrcs: [...document.querySelectorAll("img")]
          .map((i) => i.src || i.getAttribute("data-src") || "")
          .filter((s) => s.startsWith("http"))
          .slice(0, 5),
        sampleDdgExternal: [...document.querySelectorAll("img")]
          .map((i) => i.src)
          .filter((s) => s.includes("external-content.duckduckgo.com"))
          .slice(0, 2),
      };
    });

    // Test download approach on first sample URL
    const sample = result.signals.sampleImgSrcs[0];
    if (sample) {
      result.downloadTest = await page.evaluate(async (imageUrl) => {
        try {
          const r = await fetch(imageUrl, { credentials: "omit" });
          const ct = r.headers.get("content-type") || "";
          return { ok: r.ok, status: r.status, contentType: ct, via: "fetch" };
        } catch (e) {
          return { ok: false, error: e.message, via: "fetch" };
        }
      }, sample);
    }

    // DDG: test decoding wrapper URL
    const ddg = result.signals.sampleDdgExternal[0];
    if (ddg) {
      const decoded = await page.evaluate((wrapper) => {
        try {
          const u = new URL(wrapper).searchParams.get("u");
          return u ? decodeURIComponent(u) : null;
        } catch {
          return null;
        }
      }, ddg);
      result.ddgDecodedUrl = decoded;
      if (decoded) {
        result.ddgDecodedDownload = await page.evaluate(async (imageUrl) => {
          try {
            const r = await fetch(imageUrl, { credentials: "omit" });
            return { ok: r.ok, status: r.status, contentType: r.headers.get("content-type") };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }, decoded);
      }
    }
  } catch (err) {
    result.error = err.message;
  } finally {
    await browser.close();
  }

  return result;
}

console.log(`\nPlatform diagnostics for query: "${QUERY}"\n`);

for (const [name, url] of Object.entries(PLATFORMS)) {
  const r = await diagnose(name, url);
  console.log("─".repeat(60));
  console.log(`PLATFORM: ${name}`);
  console.log(`  HTTP: ${r.httpStatus} · Title: ${r.title?.slice(0, 60)}`);
  if (r.error) console.log(`  ERROR: ${r.error}`);
  if (r.signals) {
    console.log(`  Captcha/consent hint: ${r.signals.hasCaptcha}`);
    console.log(`  Images in DOM: ${r.signals.imgCount}`);
    console.log(`  Bing a.iusc: ${r.signals.bingIusc} · Google imgurl links: ${r.signals.aWithImgurl}`);
    console.log(`  DDG tiles: ${r.signals.ddgTiles} · Pinimg imgs: ${r.signals.pinimgCount}`);
    console.log(`  Sample src[0]: ${r.signals.sampleImgSrcs[0]?.slice(0, 90) ?? "none"}`);
    if (r.downloadTest) console.log(`  fetch(sample):`, r.downloadTest);
    if (r.ddgDecodedUrl) {
      console.log(`  DDG decoded: ${r.ddgDecodedUrl.slice(0, 90)}`);
      console.log(`  fetch(decoded):`, r.ddgDecodedDownload);
    }
  }
}

console.log("\n");
