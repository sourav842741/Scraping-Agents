function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrollPage(page, rounds, step = 900, pause = 700) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate((y) => window.scrollBy(0, y), step);
    await delay(pause);
  }
}

function normalizeImageUrl(url) {
  try {
    const u = new URL(url);
    for (const key of ["w", "h", "width", "height", "size", "thumb", "thumbnail"]) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function isLikelyImageUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(svg)(\?|$)/i.test(url)) return false;
  if (/gstatic\.com|google\.com\/images\/branding/i.test(url)) return false;
  if (/favicon|sprite/i.test(url) && !/\.(jpg|jpeg|png|webp|gif)/i.test(url)) return false;
  return true;
}

function dedupeUrls(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!isLikelyImageUrl(item.url)) continue;
    const key = normalizeImageUrl(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function upgradePinimgUrl(url) {
  if (!/pinimg\.com/i.test(url)) return url;
  if (/\/\d+x\d+\//.test(url)) {
    return url.replace(/\/\d+x\d+\//, "/736x/");
  }
  return url;
}

export const PLATFORM_META = {
  bing: { label: "Bing Images", referer: "https://www.bing.com/", downloadMethod: "fetch" },
  duckduckgo: {
    label: "DuckDuckGo",
    referer: "https://duckduckgo.com/",
    downloadMethod: "goto",
  },
  pinterest: { label: "Pinterest", referer: "https://www.pinterest.com/", downloadMethod: "fetch" },
  unsplash: { label: "Unsplash", referer: "https://unsplash.com/", downloadMethod: "fetch" },
  pixabay: { label: "Pixabay", referer: "https://pixabay.com/", downloadMethod: "fetch" },
};

function toItem(url, platformId) {
  const meta = PLATFORM_META[platformId];
  return {
    url,
    platform: platformId,
    referer: meta.referer,
    downloadMethod: meta.downloadMethod,
  };
}

async function extractBing(page, needed) {
  await page.waitForSelector("body", { timeout: 15000 });
  const scrollRounds = Math.min(12, Math.ceil(needed / 8) + 4);
  const step = await page.evaluate(() => Math.round(window.innerHeight * 1.2));
  await scrollPage(page, scrollRounds, step || 1000, 800);

  const urls = await page.evaluate(() => {
    const found = [];
    const seen = new Set();
    const push = (u) => {
      if (!u || seen.has(u) || !/^https?:\/\//i.test(u)) return;
      seen.add(u);
      found.push(u);
    };

    for (const a of document.querySelectorAll("a.iusc")) {
      try {
        const m = JSON.parse(a.getAttribute("m") || "{}");
        if (m.murl) push(m.murl);
      } catch {
        /* skip */
      }
    }

    if (found.length < 3) {
      for (const img of document.querySelectorAll("img.mimg")) {
        push(img.src);
      }
    }
    return found;
  });

  return dedupeUrls(urls.map((url) => toItem(url, "bing")));
}

async function extractDuckDuckGo(page, needed) {
  await delay(2000);
  await scrollPage(page, Math.min(8, Math.ceil(needed / 4) + 3), 900, 700);

  const urls = await page.evaluate((limit) => {
    const found = [];
    const seen = new Set();
    const push = (u) => {
      if (!u || seen.has(u)) return;
      if (!u.includes("external-content.duckduckgo.com/iu/")) return;
      seen.add(u);
      found.push(u);
    };

    for (const img of document.querySelectorAll("img")) {
      push(img.src);
      push(img.getAttribute("data-src"));
    }
    return found.slice(0, limit * 4);
  }, needed);

  return dedupeUrls(urls.map((url) => toItem(url, "duckduckgo")));
}

async function extractPinterest(page, needed) {
  await delay(2500);
  await scrollPage(page, Math.min(10, Math.ceil(needed / 4) + 4), 1100, 900);

  const urls = await page.evaluate(() => {
    const found = [];
    const seen = new Set();
    const push = (u) => {
      if (!u || seen.has(u) || !/pinimg\.com/i.test(u)) return;
      if (/\/\d+x\d+\//.test(u) && !/\/(236x|474x|564x|736x|originals)\//.test(u)) {
        u = u.replace(/\/\d+x\d+\//, "/736x/");
      }
      if (/\/60x60\//.test(u)) return;
      seen.add(u);
      found.push(u);
    };

    for (const img of document.querySelectorAll("img[src*='pinimg.com']")) {
      push(img.src);
      push(img.getAttribute("srcset")?.split(" ").find((p) => p.includes("pinimg.com")));
    }
    return found;
  });

  return dedupeUrls(
    urls.map((url) => toItem(upgradePinimgUrl(url), "pinterest"))
  );
}

async function extractUnsplash(page, needed) {
  await delay(2000);
  await scrollPage(page, Math.min(8, Math.ceil(needed / 5) + 3), 1000, 800);

  const urls = await page.evaluate(() => {
    const found = [];
    const seen = new Set();
    for (const img of document.querySelectorAll("img")) {
      const src =
        img.src ||
        img.getAttribute("srcset")?.split(",")[0]?.trim().split(" ")[0];
      if (!src || seen.has(src)) continue;
      if (!/images\.unsplash\.com\/photo-/i.test(src)) continue;
      if (/profile-|avatar/i.test(src)) continue;
      seen.add(src);
      found.push(src);
    }
    return found;
  });

  return dedupeUrls(urls.map((url) => toItem(url, "unsplash")));
}

async function extractPixabay(page, needed) {
  await delay(2000);
  await scrollPage(page, Math.min(8, Math.ceil(needed / 5) + 3), 1000, 800);

  const urls = await page.evaluate(() => {
    const found = [];
    const seen = new Set();
    for (const img of document.querySelectorAll("img")) {
      const src =
        img.src ||
        img.getAttribute("data-lazy") ||
        img.getAttribute("srcset")?.split(",")[0]?.trim().split(" ")[0];
      if (!src || seen.has(src)) continue;
      if (!/cdn\.pixabay\.com\/photo\//i.test(src)) continue;
      seen.add(src);
      found.push(src);
    }
    return found;
  });

  return dedupeUrls(urls.map((url) => toItem(url, "pixabay")));
}

const EXTRACTORS = {
  bing: extractBing,
  duckduckgo: extractDuckDuckGo,
  pinterest: extractPinterest,
  unsplash: extractUnsplash,
  pixabay: extractPixabay,
};

const SEARCH_URLS = {
  bing: (q) => `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2`,
  duckduckgo: (q) =>
    `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
  pinterest: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  unsplash: (q) => `https://unsplash.com/s/photos/${encodeURIComponent(q)}`,
  pixabay: (q) => `https://pixabay.com/images/search/${encodeURIComponent(q)}/`,
};

export async function searchPlatform(page, platformId, query, needed, onLog) {
  const meta = PLATFORM_META[platformId];
  if (!meta) {
    onLog("warn", `Unknown platform: ${platformId}`);
    return [];
  }

  const searchUrl = SEARCH_URLS[platformId](query);
  const extract = EXTRACTORS[platformId];

  onLog("info", `Searching ${meta.label}`, searchUrl);

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const items = await extract(page, needed);
    onLog("info", `${meta.label} returned ${items.length} candidate URLs`);
    return items;
  } catch (err) {
    onLog("warn", `${meta.label} search failed`, err.message);
    return [];
  }
}

export { normalizeImageUrl, dedupeUrls };
