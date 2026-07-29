import { launchBrowser, newPage, sleep } from "./browser.js";
import { buildGoogleMapsSearchUrl } from "./maps-url-builder.js";
import { checkProxyEgress } from "./webshare-proxy.js";

const UNLIMITED_CAP = 10000;
const UNLIMITED_SCROLL_CAP = 500;

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

async function detectMapsBlock(page) {
  const signals = await page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? "").slice(0, 8000).toLowerCase();
    const url = location.href.toLowerCase();
    return {
      captcha:
        url.includes("/sorry/") ||
        bodyText.includes("unusual traffic") ||
        bodyText.includes("not a robot"),
      noFeed: !document.querySelector('div[role="feed"]'),
      emptyFeed:
        document.querySelectorAll('div[role="feed"] a[href*="/maps/place"]').length === 0,
      title: document.title,
      url: location.href,
    };
  });

  const reasons = [];
  if (signals.captcha) reasons.push("captcha");
  if (signals.noFeed) reasons.push("noFeed");
  if (signals.emptyFeed) reasons.push("emptyFeed");

  return {
    blocked: reasons.includes("captcha") || (reasons.includes("noFeed") && reasons.includes("emptyFeed")),
    reasons,
    pageTitle: signals.title,
    finalUrl: signals.url,
  };
}

function isRotationWorthy({ block, error, hadProgress }) {
  if (error) return true;
  if (!block?.blocked) return false;
  if (block.reasons?.includes("captcha")) return true;
  if (!hadProgress && block.reasons?.length) return true;
  return false;
}

async function extractPlacePanelDetails(page) {
  return page.evaluate(() => {
    let website = "";
    let phone = "";
    let email = "";

    for (const el of document.querySelectorAll("[data-item-id]")) {
      const id = el.getAttribute("data-item-id") ?? "";
      if (id.startsWith("phone:tel:") && !phone) {
        phone = id.replace(/^phone:tel:/i, "").trim();
      }
      if (id === "authority" && el.href && !/google\.com/i.test(el.href)) {
        website = el.href.split("?")[0];
      }
    }

    const webLink =
      document.querySelector('a[data-item-id="authority"]') ||
      document.querySelector('a[aria-label*="Website" i]');
    if (!website && webLink?.href && !/google\.com/i.test(webLink.href)) {
      website = webLink.href.split("?")[0];
    }

    const telLink = document.querySelector('a[href^="tel:"]');
    if (!phone && telLink) {
      phone = telLink.getAttribute("href")?.replace(/^tel:/i, "").trim() ?? "";
    }

    const mailLink = document.querySelector('a[href^="mailto:"]');
    if (mailLink) {
      email = mailLink.getAttribute("href")?.replace(/^mailto:/i, "").split("?")[0].trim() ?? "";
    }

    const panel = document.querySelector('div[role="main"]');
    const text = panel?.innerText ?? "";

    if (!email) {
      const mailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (mailMatch) email = mailMatch[0];
    }

    if (!phone) {
      const phoneMatch = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
      if (phoneMatch) phone = phoneMatch[0].trim();
    }

    return { website, phone, email };
  });
}

async function enrichPlaceDetails(page, place, searchUrl) {
  try {
    await page.goto(place.mapsUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2200);
    try {
      await page.waitForSelector(
        'a[data-item-id="authority"], a[href^="tel:"], button[data-item-id^="phone:tel:"], h1',
        { timeout: 8000 }
      );
    } catch {
      /* panel may still have partial data */
    }

    const details = await extractPlacePanelDetails(page);

    if (searchUrl) {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
      await sleep(1800);
    }

    return {
      ...place,
      phone: details.phone || place.phone || "",
      website: details.website || "",
      email: details.email || "",
    };
  } catch {
    return {
      ...place,
      phone: place.phone ?? "",
      website: place.website ?? "",
      email: place.email ?? "",
    };
  }
}

async function extractVisiblePlaces(page, { searchQuery, scrollRound }) {
  return page.evaluate(
    ({ searchQuery, scrollRound }) => {
      const items = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div[role="feed"] > div > div[jsaction]');

      for (const card of cards) {
        const link = card.querySelector('a[href*="/maps/place"]');
        if (!link) continue;

        const href = link.href?.split("?")[0];
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const name =
          card.querySelector(".fontHeadlineSmall")?.textContent?.trim() ||
          link.getAttribute("aria-label")?.trim() ||
          link.textContent?.trim();
        if (!name) continue;

        const ratingEl = card.querySelector('span[role="img"][aria-label*="star"]');
        const ratingLabel = ratingEl?.getAttribute("aria-label") ?? "";
        const ratingMatch = ratingLabel.match(/([\d.]+)/);
        const rating = ratingMatch ? ratingMatch[1] : "";

        const metaSpans = [...card.querySelectorAll("span")]
          .map((s) => s.textContent?.trim())
          .filter(Boolean);
        const reviewMatch = metaSpans.join(" ").match(/([\d,]+)\s+reviews?/i);
        const reviewCount = reviewMatch ? reviewMatch[1].replace(/,/g, "") : "";

        const bodyLines = [...card.querySelectorAll(".fontBodyMedium span, .fontBodyMedium div")]
          .map((el) => el.textContent?.trim())
          .filter(Boolean);

        const isHoursLine = (t) => /open|closed|hours|reopens|24\s*hours/i.test(t);
        const category =
          bodyLines.find((t) => t !== name && !isHoursLine(t) && !/^\d/.test(t) && t.length < 80) || "";

        const address =
          bodyLines.find(
            (t) =>
              t !== name &&
              t !== category &&
              !isHoursLine(t) &&
              (t.includes(",") || /\d{3,}/.test(t))
          ) || "";

        const phoneMatch = card.textContent?.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
        const phone = phoneMatch ? phoneMatch[0].trim() : "";

        const statusChip = card.querySelector(".fontBodyMedium + div, .fontBodyMedium span.fontBodyMedium");
        const status =
          statusChip?.textContent?.includes("Open") || statusChip?.textContent?.includes("Closed")
            ? statusChip.textContent.trim()
            : "";

        items.push({
          name,
          mapsUrl: href,
          rating,
          reviewCount,
          category,
          address,
          phone,
          website: "",
          email: "",
          status,
          scrollRound,
          searchQuery,
        });
      }

      return items;
    },
    { searchQuery, scrollRound }
  );
}

async function scrollResultsFeed(page) {
  return page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { scrolled: false, scrollTop: 0, scrollHeight: 0, moved: false };
    const before = feed.scrollTop;
    feed.scrollTop = feed.scrollHeight;
    return {
      scrolled: true,
      scrollTop: feed.scrollTop,
      scrollHeight: feed.scrollHeight,
      moved: feed.scrollTop > before,
    };
  });
}

async function closeBrowser(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    /* ignore */
  }
}

async function openProxySession({ proxyManager, headless, emit }) {
  const rotation = proxyManager.rotateForSite("google-maps");
  emit("proxy-rotation", {
    rotationIndex: rotation.entry.index,
    message: `Proxy rotation #${rotation.entry.index} for Google Maps`,
    rotation: rotation.entry,
  });

  const browser = await launchBrowser({ headless, proxyServer: rotation.proxyServer });
  const page = await newPage(browser, {
    proxyAuth: { username: rotation.username, password: rotation.password },
  });

  const ipCheck = await checkProxyEgress(page);
  proxyManager.completeRotation(rotation.entry, {
    scrapeJobs: 0,
    status: ipCheck.ok ? "active" : "warn",
    ipCheck,
  });
  emit("proxy-ip", { rotationIndex: rotation.entry.index, ipCheck });

  return { browser, page, rotationEntry: rotation.entry };
}

async function navigateToMaps(page, url, emit) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      const status = response?.status() ?? null;
      if (status === 407 || status === 403 || status === 429) {
        throw new Error(`HTTP ${status} rejected by proxy or Google`);
      }
      await dismissGoogleConsent(page);
      await sleep(2500);
      return { ok: true, status };
    } catch (err) {
      if (attempt === 2) throw err;
      emit("status", { message: `Navigation retry (${err.message})` });
      await sleep(2000);
    }
  }
  throw new Error("Failed to open Google Maps");
}

const SOFT_CAP_THRESHOLD = 50;
const SOFT_CAP_MAX_SCROLLS = 12;

function isSoftFeedCap({ unlimited, useProxy, scrollRound, total }) {
  return (
    unlimited &&
    useProxy &&
    total > 0 &&
    total < SOFT_CAP_THRESHOLD &&
    scrollRound < SOFT_CAP_MAX_SCROLLS
  );
}

async function runScrollSession({
  page,
  query,
  maxResults,
  maxScrolls,
  unlimited = false,
  useProxy = false,
  enrichDetails = true,
  searchUrl,
  signal,
  allResults,
  seenUrls,
  scrollRoundStart,
  emit,
}) {
  let scrollRound = scrollRoundStart;
  let stagnantRounds = 0;
  let lastBlock = null;
  let lastError = null;

  while (!signal?.aborted && allResults.length < maxResults && scrollRound < maxScrolls) {
    scrollRound += 1;
    const batch = await extractVisiblePlaces(page, { searchQuery: query, scrollRound });
    let newOnRound = 0;

    for (const item of batch) {
      if (seenUrls.has(item.mapsUrl)) continue;
      seenUrls.add(item.mapsUrl);

      let enriched = item;
      if (enrichDetails) {
        enriched = await enrichPlaceDetails(page, item, searchUrl);
        if (signal?.aborted) break;
      }

      const result = {
        id: `m-${allResults.length + 1}`,
        position: allResults.length + 1,
        ...enriched,
      };
      allResults.push(result);
      newOnRound += 1;

      emit("progress", {
        current: allResults.length,
        total: maxResults,
        scrollRound,
        result,
      });

      if (allResults.length >= maxResults) break;
      await sleep(400);
    }

    emit("scroll-complete", { scrollRound, newOnRound, total: allResults.length });

    if (allResults.length >= maxResults) break;

    lastBlock = await detectMapsBlock(page);
    if (lastBlock.blocked && lastBlock.reasons?.includes("captcha")) {
      lastError = new Error(`Rejected: ${lastBlock.reasons.join(", ")}`);
      emit("reject", { site: "google-maps", scrollRound, collected: allResults.length, ...lastBlock });
      return { stopped: "reject", scrollRound, block: lastBlock, error: lastError.message };
    }

    if (newOnRound === 0) {
      stagnantRounds += 1;
      if (stagnantRounds >= 3) {
        const softCap = isSoftFeedCap({
          unlimited,
          useProxy,
          scrollRound,
          total: allResults.length,
        });
        if (softCap) {
          const reasons = ["feedTruncated", "softCap"];
          emit("reject", {
            site: "google-maps",
            phase: "scroll",
            scrollRound,
            collected: allResults.length,
            blocked: true,
            reasons,
            message: `Proxy IP soft-capped at ${allResults.length} results (feed stopped early)`,
          });
          return {
            stopped: "reject",
            scrollRound,
            block: { blocked: true, reasons },
            error: `Soft cap: only ${allResults.length} results before plateau`,
          };
        }
        emit("plateau", {
          message: `No new businesses after ${stagnantRounds} scroll rounds — end of list`,
          scrollRound,
          total: allResults.length,
        });
        return { stopped: "plateau", scrollRound, block: null, error: null };
      }
    } else {
      stagnantRounds = 0;
    }

    const scroll = await scrollResultsFeed(page);
    if (!scroll.scrolled || !scroll.moved) {
      const softCap = isSoftFeedCap({
        unlimited,
        useProxy,
        scrollRound,
        total: allResults.length,
      });
      if (softCap) {
        const reasons = ["feedTruncated", "feedBottom"];
        emit("reject", {
          site: "google-maps",
          phase: "scroll",
          scrollRound,
          collected: allResults.length,
          blocked: true,
          reasons,
          message: `Proxy IP soft-capped at ${allResults.length} results (feed bottom too early)`,
        });
        return {
          stopped: "reject",
          scrollRound,
          block: { blocked: true, reasons },
          error: `Soft cap: feed bottom at ${allResults.length} results`,
        };
      }
      emit("plateau", {
        message: "Feed scroll reached bottom",
        scrollRound,
        total: allResults.length,
      });
      return { stopped: "plateau", scrollRound, block: null, error: null };
    }

    await sleep(1800 + Math.random() * 1200);
  }

  return {
    stopped: allResults.length >= maxResults ? "cap" : "scroll-limit",
    scrollRound,
    block: lastBlock,
    error: lastError?.message ?? null,
  };
}

export async function collectGoogleMapsBusinesses({
  query,
  location = "",
  maxResults = 100,
  maxScrolls = 50,
  unlimited = false,
  maxRotations = 15,
  enrichDetails = true,
  headless = true,
  signal,
  proxyManager,
  onEvent,
}) {
  const emit = (type, data = {}) => onEvent?.({ type, ...data });

  const effectiveMax = unlimited ? UNLIMITED_CAP : maxResults;
  const effectiveScrolls = unlimited ? UNLIMITED_SCROLL_CAP : maxScrolls;
  const url = buildGoogleMapsSearchUrl({ query, location });

  const allResults = [];
  const seenUrls = new Set();
  let totalScrollRounds = 0;
  let rotationAttempts = 0;
  let lastBlock = null;
  let lastError = null;
  let finalStatus = "failed";

  emit("status", {
    message: `Opening Maps: "${query}"${location ? ` · ${location}` : ""}${unlimited ? " · unlimited" : ""}`,
    url,
  });

  while (!signal?.aborted) {
    let browser = null;
    let rotationEntry = null;
    let sessionError = null;

    try {
      let page;

      if (proxyManager) {
        const session = await openProxySession({ proxyManager, headless, emit });
        browser = session.browser;
        page = session.page;
        rotationEntry = session.rotationEntry;
        rotationAttempts += 1;
      } else {
        rotationAttempts += 1;
        browser = await launchBrowser({ headless });
        page = await newPage(browser);
      }

      if (rotationAttempts > 1) {
        emit("rotation-resume", {
          rotationAttempts,
          collected: allResults.length,
          message: `Resuming after rotation #${rotationAttempts} (${allResults.length} already collected)`,
        });
      }

      await navigateToMaps(page, url, emit);

      const openBlock = await detectMapsBlock(page);
      if (openBlock.blocked) {
        lastBlock = openBlock;
        sessionError = `Rejected on open: ${openBlock.reasons.join(", ")}`;
        emit("reject", {
          site: "google-maps",
          phase: "open",
          collected: allResults.length,
          ...openBlock,
        });

        if (proxyManager && rotationAttempts < maxRotations) {
          if (rotationEntry) {
            proxyManager.completeRotation(rotationEntry, {
              scrapeJobs: allResults.length,
              status: "error",
            });
          }
          await closeBrowser(browser);
          emit("status", { message: `Rotating proxy after reject (${rotationAttempts}/${maxRotations})…` });
          await sleep(1500);
          continue;
        }

        finalStatus = allResults.length > 0 ? "partial" : "blocked";
        break;
      }

      const session = await runScrollSession({
        page,
        query,
        maxResults: effectiveMax,
        maxScrolls: effectiveScrolls - totalScrollRounds,
        unlimited,
        useProxy: Boolean(proxyManager),
        enrichDetails,
        searchUrl: url,
        signal,
        allResults,
        seenUrls,
        scrollRoundStart: totalScrollRounds,
        emit,
      });

      totalScrollRounds = session.scrollRound;
      lastBlock = session.block ?? lastBlock;
      lastError = session.error ?? null;

      if (rotationEntry) {
        proxyManager.completeRotation(rotationEntry, {
          scrapeJobs: allResults.length,
          status: session.stopped === "reject" ? "error" : "ok",
        });
      }

      await closeBrowser(browser);
      browser = null;

      if (session.stopped === "reject" && proxyManager && rotationAttempts < maxRotations) {
        emit("status", {
          message: `Rotating proxy after mid-scroll reject (${rotationAttempts}/${maxRotations})…`,
        });
        await sleep(1500);
        continue;
      }

      if (session.stopped === "plateau" || session.stopped === "cap") {
        finalStatus = "ok";
        break;
      }

      if (session.stopped === "scroll-limit" && unlimited && proxyManager && rotationAttempts < maxRotations) {
        emit("status", { message: "Scroll cap hit — rotating proxy to continue…" });
        await sleep(1500);
        continue;
      }

      finalStatus = allResults.length > 0 ? "partial" : "failed";
      break;
    } catch (err) {
      sessionError = err.message;
      lastError = err.message;
      emit("error", { message: err.message, rotationAttempts, collected: allResults.length });
      emit("reject", {
        site: "google-maps",
        phase: "error",
        collected: allResults.length,
        reasons: ["error"],
        error: err.message,
      });

      if (rotationEntry && proxyManager) {
        proxyManager.completeRotation(rotationEntry, {
          scrapeJobs: allResults.length,
          status: "error",
        });
      }

      await closeBrowser(browser);

      if (proxyManager && rotationAttempts < maxRotations && isRotationWorthy({ error: err, hadProgress: allResults.length > 0 })) {
        emit("status", { message: `Rotating proxy after error (${rotationAttempts}/${maxRotations})…` });
        await sleep(2000);
        continue;
      }

      finalStatus = allResults.length > 0 ? "partial" : "failed";
      break;
    }
  }

  return {
    ok: allResults.length > 0,
    results: allResults,
    scrollRounds: totalScrollRounds,
    rotationAttempts,
    unlimited,
    status: finalStatus,
    block: allResults.length > 0 ? null : lastBlock,
    error: lastError,
    url,
  };
}
