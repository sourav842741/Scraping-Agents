import { launchBrowser, newPage, goto, sleep } from "./browser.js";
import { buildGoogleSearchUrl } from "./google-url-builder.js";
import { detectGoogleBlock } from "./detect-block.js";
import { classifyWebsite } from "./website-check.js";
import { checkProxyEgress } from "./webshare-proxy.js";

const RESULTS_PER_PAGE = 10;
const MAX_PAGES_SAFETY = 100;

async function dismissGoogleConsent(page) {
  try {
    const clicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button, div[role=button]")];
      const accept = buttons.find((b) => {
        const t = (b.textContent ?? "").toLowerCase();
        return (
          t.includes("accept all") ||
          t.includes("i agree") ||
          t.includes("agree") ||
          t === "accept"
        );
      });
      if (accept) {
        accept.click();
        return true;
      }
      return false;
    });
    if (clicked) await sleep(1500);
  } catch {
    /* ignore */
  }
}

async function extractPageResults(page, { pageNum, searchQuery }) {
  return page.evaluate(
    ({ pageNum, searchQuery }) => {
      const items = [];
      const seen = new Set();
      const containers = document.querySelectorAll(
        "#search div.g, div[data-sokoban-container] div.g, div.MjjYud"
      );

      for (const el of containers) {
        const link =
          el.querySelector("a[href^='http']") ||
          el.querySelector("a[jsname][href]");
        if (!link) continue;

        const href = link.href;
        if (
          !href ||
          href.includes("google.com/search") ||
          href.includes("webcache.googleusercontent") ||
          seen.has(href)
        ) {
          continue;
        }
        seen.add(href);

        const titleEl =
          el.querySelector("h3") ||
          link.querySelector("h3") ||
          el.querySelector("[role=heading]");
        const title = (titleEl?.textContent ?? link.textContent ?? "").trim();
        if (!title) continue;

        const snippetEl =
          el.querySelector(".VwiC3b") ||
          el.querySelector(".IsZvec") ||
          el.querySelector("div[data-sncf]") ||
          el.querySelector(".MUxGbd");
        const snippet = (snippetEl?.textContent ?? "").trim();

        items.push({
          title,
          url: href,
          snippet,
          page: pageNum,
          searchQuery,
        });
      }

      return items;
    },
    { pageNum, searchQuery }
  );
}

async function hasNextPage(page) {
  return page.evaluate(() => {
    const next = document.querySelector("#pnnext, a[aria-label='Next page'], a#pnnext");
    if (!next) return false;
    const rect = next.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export async function collectGoogleResults({
  query,
  location = "",
  maxResults = 500,
  scrapeAll = false,
  headless = true,
  signal,
  proxyManager,
  onEvent,
}) {
  const emit = (type, data = {}) => {
    onEvent?.({ type, ...data });
  };

  let browser = null;
  let rotationEntry = null;

  try {
    let proxyAuth = null;
    let proxyServer = null;

    if (proxyManager) {
      const rotation = proxyManager.rotateForSite("google");
      proxyAuth = {
        username: rotation.username,
        password: rotation.password,
      };
      proxyServer = rotation.proxyServer;
      rotationEntry = rotation.entry;
      emit("proxy-rotation", {
        rotationIndex: rotation.entry.index,
        message: `Proxy rotation #${rotation.entry.index} for Google search`,
        rotation: rotation.entry,
      });
    }

    browser = await launchBrowser({ headless, proxyServer });
    const page = await newPage(browser, { proxyAuth });

    if (proxyManager && rotationEntry) {
      const ipCheck = await checkProxyEgress(page);
      proxyManager.completeRotation(rotationEntry, {
        scrapeJobs: 0,
        status: ipCheck.ok ? "active" : "warn",
        ipCheck,
      });
      emit("proxy-ip", {
        rotationIndex: rotationEntry.index,
        ipCheck,
      });
    }

    const allResults = [];
    const seenUrls = new Set();
    let pageNum = 0;
    let start = 0;
    let block = null;
    let lastError = null;

    const effectiveMax = scrapeAll ? 10000 : maxResults;

    emit("status", { message: `Starting Google search: "${query}"` });

    const warmupUrl = "https://www.google.com/";
    emit("status", { message: `Warmup: visiting ${warmupUrl}` });
    try {
      await goto(page, warmupUrl, { timeout: 30000 });
      await dismissGoogleConsent(page);
      await sleep(1500 + Math.random() * 1000);
      emit("status", { message: `Warmup done: ${page.url()}` });
    } catch (warmupErr) {
      emit("status", { message: `Warmup skipped: ${warmupErr.message}` });
    }

    while (!signal?.aborted) {
      pageNum += 1;
      const url = buildGoogleSearchUrl({
        query,
        location,
        start,
        num: RESULTS_PER_PAGE,
      });

      emit("status", {
        message: `Page ${pageNum} · start=${start}`,
        page: pageNum,
        url,
      });

      const nav = await goto(page, url, { timeout: 60000 });
      emit("status", { message: `Nav: status=${nav.status} url=${nav.finalUrl}` });

      if (nav.finalUrl.includes("/sorry/")) {
        emit("status", { message: "Google CAPTCHA page detected in URL" });
      }

      await dismissGoogleConsent(page);
      await sleep(1200);

      block = await detectGoogleBlock(page);
      if (block.blocked) {
        emit("block", { site: "google", ...block });
        break;
      }

      const rawItems = await extractPageResults(page, { pageNum, searchQuery: query });
      let newOnPage = 0;

      for (const item of rawItems) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);

        const { domain, hasWebsite, websiteType } = classifyWebsite(item.url);
        const result = {
          id: `r-${allResults.length + 1}`,
          position: allResults.length + 1,
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          domain,
          hasWebsite,
          websiteType,
          remarks: "",
          page: item.page,
          searchQuery: query,
        };

        allResults.push(result);
        newOnPage += 1;

        emit("progress", {
          current: allResults.length,
          total: effectiveMax,
          result,
        });

        if (!scrapeAll && allResults.length >= maxResults) {
          break;
        }
      }

      emit("page-complete", {
        page: pageNum,
        newOnPage,
        total: allResults.length,
        status: nav.status,
      });

      if (!scrapeAll && allResults.length >= maxResults) break;
      if (newOnPage === 0) {
        emit("plateau", {
          message: `No new results on page ${pageNum} — end of index`,
        });
        break;
      }

      if (pageNum >= MAX_PAGES_SAFETY) {
        emit("status", {
          message: `Safety cap reached (${MAX_PAGES_SAFETY} pages)`,
        });
        break;
      }

      const next = await hasNextPage(page);
      if (!next) {
        emit("plateau", { message: "No Next page — reached end of Google results" });
        break;
      }

      start += RESULTS_PER_PAGE;
      await sleep(1500 + Math.random() * 1000);
    }

    if (proxyManager && rotationEntry) {
      proxyManager.completeRotation(rotationEntry, {
        scrapeJobs: allResults.length,
        status: block?.blocked ? "error" : "ok",
      });
      emit("proxy-rotation-complete", {
        rotation: rotationEntry,
        totalResults: allResults.length,
      });
    }

    const ok = allResults.length > 0 && !block?.blocked;

    return {
      ok,
      results: allResults,
      pagesScraped: pageNum,
      block,
      error: lastError,
      plateau: !block?.blocked && allResults.length > 0,
    };
  } catch (err) {
    if (proxyManager && rotationEntry) {
      proxyManager.completeRotation(rotationEntry, {
        scrapeJobs: 0,
        status: "error",
      });
    }
    emit("error", { message: err.message });
    return {
      ok: false,
      results: [],
      pagesScraped: 0,
      block: null,
      error: err.message,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}
