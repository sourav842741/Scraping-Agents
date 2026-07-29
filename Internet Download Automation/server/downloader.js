import { createWriteStream, mkdirSync, renameSync, unlinkSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { extname, join } from "path";
import { createHash } from "crypto";
import { paths } from "./db.js";
import { config } from "./config.js";
import { searchPlatform, normalizeImageUrl } from "./platforms.js";
import { launchBrowser, setupPage } from "./browser.js";
import { checkProxyEgress } from "./webshare-proxy.js";
import { createMutex, JobCancelledError } from "./jobControl.js";
import { captureScrollSnapshots } from "./snapshots.js";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeExt(url, contentType) {
  try {
    const fromUrl = extname(new URL(url).pathname).toLowerCase().split("?")[0];
    if (IMAGE_EXT.has(fromUrl)) return fromUrl;
  } catch {
    /* ignore */
  }
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/avif": ".avif",
  };
  return map[contentType?.split(";")[0]?.trim()] ?? ".jpg";
}

function validateImageBuffer(buf, contentType) {
  if (buf.length < 1024) {
    throw new Error("File too small — likely a placeholder or blocked response");
  }
  if (buf.length > config.maxFileBytes) {
    throw new Error(`File exceeds ${Math.round(config.maxFileBytes / 1024 / 1024)}MB limit`);
  }
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`Not an image (content-type: ${contentType || "unknown"})`);
  }
}

async function downloadViaFetch(page, url, referer) {
  const result = await page.evaluate(
    async ({ imageUrl, refererUrl, timeoutMs, maxBytes }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(imageUrl, {
          signal: controller.signal,
          headers: refererUrl ? { Referer: refererUrl } : {},
          credentials: "omit",
        });

        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
        }

        const contentType = res.headers.get("content-type") ?? "";
        const ab = await res.arrayBuffer();
        if (ab.byteLength < 1024) {
          return { ok: false, error: "File too small — likely a placeholder or blocked response" };
        }
        if (ab.byteLength > maxBytes) {
          return { ok: false, error: `File exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit` };
        }
        if (!contentType.startsWith("image/")) {
          return { ok: false, error: `Not an image (content-type: ${contentType || "unknown"})` };
        }

        return {
          ok: true,
          contentType,
          bytes: Array.from(new Uint8Array(ab)),
          size: ab.byteLength,
        };
      } catch (err) {
        return { ok: false, error: err.name === "AbortError" ? "Download timeout" : err.message };
      } finally {
        clearTimeout(timer);
      }
    },
    {
      imageUrl: url,
      refererUrl: referer,
      timeoutMs: config.downloadTimeoutMs,
      maxBytes: config.maxFileBytes,
    }
  );

  if (!result.ok) throw new Error(result.error);

  const buf = Buffer.from(result.bytes);
  const contentHash = createHash("sha256").update(buf).digest("hex");
  return { buffer: buf, size: result.size, contentType: result.contentType, contentHash };
}

async function downloadViaGoto(page, url) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.downloadTimeoutMs,
  });

  if (!response || !response.ok()) {
    throw new Error(`HTTP ${response?.status() ?? "unknown"} ${response?.statusText() ?? ""}`);
  }

  const contentType = response.headers()["content-type"] ?? "";
  const buf = await response.buffer();
  validateImageBuffer(buf, contentType);

  const contentHash = createHash("sha256").update(buf).digest("hex");
  return { buffer: buf, size: buf.length, contentType, contentHash };
}

async function downloadImage(page, item, destPath, control) {
  const meta =
    item.downloadMethod === "goto"
      ? await downloadViaGoto(page, item.url)
      : await downloadViaFetch(page, item.url, item.referer);

  await pipeline(Readable.from(meta.buffer), createWriteStream(destPath));
  return meta;
}

async function downloadWithRetry(page, item, destPath, control) {
  let lastError;
  for (let attempt = 1; attempt <= config.retryCount; attempt++) {
    control?.check();
    try {
      return await downloadImage(page, item, destPath, control);
    } catch (err) {
      if (err instanceof JobCancelledError) throw err;
      lastError = err;
      try {
        unlinkSync(destPath);
      } catch {
        /* not created */
      }
      if (attempt < config.retryCount) {
        await delay(config.retryBackoffMs * attempt);
      }
    }
  }
  throw lastError;
}

async function primePage(page, referer) {
  if (!referer) return;
  try {
    await page.goto(referer, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    /* best effort */
  }
}

async function createPagePool(browser, searchPage, size, referer) {
  const pages = [searchPage];
  for (let i = 1; i < size; i++) {
    const p = await setupPage(await browser.newPage());
    await primePage(p, referer);
    pages.push(p);
  }

  let idx = 0;
  return {
    pages,
    acquire() {
      const page = pages[idx % pages.length];
      idx += 1;
      return page;
    },
    async closeExtra() {
      await Promise.all(pages.slice(1).map((p) => p.close().catch(() => {})));
    },
  };
}

async function openSession({ proxyMode, proxyManager, platformId, onLog, shared, control }) {
  control.check();

  if (proxyMode) {
    const rotation = proxyManager.rotateForPlatform(platformId);
    onLog(
      "info",
      `Proxy rotation #${rotation.entry.index} for ${platformId}`,
      `${rotation.entry.usernameMasked} · ${rotation.proxyServer}`
    );
    const browser = control.trackBrowser(
      await launchBrowser({
        headless: config.headless,
        proxyServer: rotation.proxyServer,
      })
    );
    const page = await setupPage(await browser.newPage(), {
      proxyAuth: { username: rotation.username, password: rotation.password },
    });
    onLog("info", "Checking proxy egress IP", "ipinfo.io");
    const ipCheck = await checkProxyEgress(page);
    proxyManager.completeRotation(rotation.entry, {
      status: ipCheck.ok ? "ok" : "warn",
      ipCheck,
    });
    if (ipCheck.ok) {
      onLog(
        "info",
        `Proxy egress #${rotation.entry.index}`,
        `${ipCheck.ip} · ${ipCheck.city ?? "?"}, ${ipCheck.country ?? "?"}`
      );
    } else {
      onLog("warn", "Proxy IP check failed", ipCheck.error ?? "unknown — continuing");
    }
    return { browser, page, rotation };
  }

  if (!shared.browser) {
    onLog("info", "Launching headless browser", "Puppeteer · local IP");
    shared.browser = control.trackBrowser(
      await launchBrowser({ headless: config.headless })
    );
    shared.page = await setupPage(await shared.browser.newPage());
  }
  return { browser: shared.browser, page: shared.page, rotation: null };
}

async function collectCandidates({
  sources,
  query,
  count,
  proxyMode,
  proxyManager,
  shared,
  control,
  onLog,
}) {
  const allItems = [];
  const seenNorm = new Set();

  for (const platformId of sources) {
    control.check();

    let browser = null;
    let page = null;
    let rotation = null;

    try {
      ({ browser, page, rotation } = await openSession({
        proxyMode,
        proxyManager,
        platformId,
        onLog,
        shared,
        control,
      }));

      const found = await searchPlatform(page, platformId, query, count, onLog);
      let added = 0;
      for (const item of found) {
        const key = normalizeImageUrl(item.url);
        if (seenNorm.has(key)) continue;
        seenNorm.add(key);
        allItems.push(item);
        added += 1;
      }
      onLog("info", `${platformId}: ${added} new URLs`, `${seenNorm.size} unique total`);
    } finally {
      if (proxyMode && browser) {
        control.untrackBrowser(browser);
        await browser.close().catch(() => {});
        if (rotation) {
          proxyManager.completeRotation(rotation.entry, { status: "ok" });
        }
      }
      await delay(config.searchDelayMs);
    }
  }

  if (!proxyMode && shared.browser) {
    control.untrackBrowser(shared.browser);
    await shared.browser.close().catch(() => {});
    shared.browser = null;
    shared.page = null;
  }

  return { items: allItems, seenNorm };
}

async function downloadBatch({
  browser,
  searchPage,
  items,
  count,
  parallelDownloads,
  referer,
  jobDir,
  control,
  state,
  mutex,
  onLog,
  onProgress,
}) {
  const pool = await createPagePool(browser, searchPage, parallelDownloads, referer);
  let cursor = 0;

  async function worker() {
    while (true) {
      control.check();
      const index = await mutex.run(async () => {
        if (state.success >= count) return -1;
        const i = cursor;
        cursor += 1;
        return i < items.length ? i : -1;
      });
      if (index < 0) break;

      const item = items[index];
      const page = pool.acquire();
      const urlTag = createHash("md5").update(item.url).digest("hex").slice(0, 8);
      const destPath = join(jobDir, `tmp-${urlTag}.jpg`);

      onLog("info", `Trying [${item.platform}] (${state.success}/${count})`, item.url);

      try {
        const { size, contentType, contentHash } = await downloadWithRetry(
          page,
          item,
          destPath,
          control
        );

        await mutex.run(async () => {
          if (state.success >= count) {
            unlinkSync(destPath);
            return;
          }
          if (state.seenContentHashes.has(contentHash)) {
            unlinkSync(destPath);
            state.skippedDuplicates += 1;
            onLog("warn", "Skipped duplicate image", "Same pixels as an earlier file");
            return;
          }
          state.seenContentHashes.add(contentHash);

          const slot = state.success + 1;
          const ext = safeExt(item.url, contentType);
          const fileHash = contentHash.slice(0, 8);
          const finalName = `image-${String(slot).padStart(3, "0")}-${fileHash}${ext}`;
          renameSync(destPath, join(jobDir, finalName));

          state.success += 1;
          onLog(
            "success",
            `Saved ${finalName}`,
            `${(size / 1024).toFixed(1)} KB · ${item.platform} · ${state.success}/${count}`
          );
          onProgress({
            success_count: state.success,
            failed_count: state.failed,
            file: {
              filename: finalName,
              sourceUrl: item.url,
              fileSize: size,
              status: "success",
              sourcePlatform: item.platform,
              fileKind: "image",
            },
          });
        });
      } catch (err) {
        if (err instanceof JobCancelledError) throw err;
        try {
          unlinkSync(destPath);
        } catch {
          /* not created */
        }
        await mutex.run(async () => {
          state.failed += 1;
          onLog("error", `Failed [${item.platform}]`, `${item.url} — ${err.message}`);
          onProgress({
            success_count: state.success,
            failed_count: state.failed,
            file: {
              filename: null,
              sourceUrl: item.url,
              status: "failed",
              failureReason: err.message,
            },
          });
        });
      }

      if (parallelDownloads > 1) await delay(config.downloadDelayMs);
    }
  }

  try {
    await Promise.all(Array.from({ length: parallelDownloads }, () => worker()));
  } finally {
    await pool.closeExtra();
  }
}

async function runSnapshotJob({
  jobId,
  query,
  count,
  sources,
  autoMode,
  proxyMode,
  proxyManager,
  control,
  onLog,
  onProgress,
}) {
  const jobDir = join(paths.storage, jobId);
  mkdirSync(jobDir, { recursive: true });
  const shared = { browser: null, page: null };
  const state = { success: 0, failed: 0 };

  const sourceLabel = autoMode ? "Auto — all platforms" : sources.join(", ");
  onLog("info", "Snapshot mode", `${sourceLabel} · ${count} scroll panel(s) per platform`);

  for (const platformId of sources) {
    control.check();

    let browser = null;
    let page = null;
    let rotation = null;

    try {
      ({ browser, page, rotation } = await openSession({
        proxyMode,
        proxyManager,
        platformId,
        onLog,
        shared,
        control,
      }));

      await searchPlatform(page, platformId, query, count, onLog);
      await captureScrollSnapshots({
        page,
        platformId,
        panelCount: count,
        jobDir,
        control,
        onLog,
        onProgress,
        state,
      });
    } finally {
      if (proxyMode && browser) {
        control.untrackBrowser(browser);
        await browser.close().catch(() => {});
        if (rotation) {
          proxyManager.completeRotation(rotation.entry, { status: "ok" });
        }
      }
      await delay(config.searchDelayMs);
    }
  }

  if (!proxyMode && shared.browser) {
    control.untrackBrowser(shared.browser);
    await shared.browser.close().catch(() => {});
  }

  if (state.success === 0) {
    throw new Error("No snapshots captured. Try different platforms or keywords.");
  }

  const expected = count * sources.length;
  const status = state.success < expected ? "partial" : "completed";
  onLog(
    status === "completed" ? "success" : "warn",
    `Snapshot job finished — ${state.success} panel(s) saved`,
    `storage/downloads/${jobId}/`
  );

  return {
    status,
    found_count: state.success,
    success_count: state.success,
    failed_count: state.failed,
    proxyReport: proxyMode && proxyManager ? proxyManager.buildReport() : null,
    failure_reason:
      state.success < expected
        ? `Captured ${state.success} of ~${expected} requested panel(s).`
        : null,
  };
}

export async function runDownloadJob({
  jobId,
  query,
  count,
  sources,
  autoMode,
  proxyMode,
  proxyManager,
  parallelDownloads = 1,
  snapshotMode = false,
  reviewMode = false,
  control,
  onLog,
  onProgress,
}) {
  if (snapshotMode) {
    return runSnapshotJob({
      jobId,
      query,
      count,
      sources,
      autoMode,
      proxyMode,
      proxyManager,
      control,
      onLog,
      onProgress,
    });
  }
  const jobDir = join(paths.storage, jobId);
  mkdirSync(jobDir, { recursive: true });

  const shared = { browser: null, page: null };
  const state = {
    success: 0,
    failed: 0,
    skippedDuplicates: 0,
    seenContentHashes: new Set(),
  };
  const mutex = createMutex();
  const concurrency = Math.min(
    config.maxDownloadConcurrency,
    Math.max(1, Number(parallelDownloads) || 1)
  );

  try {
    const sourceLabel = autoMode ? "Auto — all platforms" : sources.join(", ");
    onLog(
      "info",
      "Platform selection",
      `${sourceLabel} · ${proxyMode ? "Webshare rotating proxy" : "local IP"} · ${concurrency} parallel`
    );

    onLog("info", "Phase 1 — searching all platforms", "Collecting URLs before downloading");
    const { items: allItems, seenNorm } = await collectCandidates({
      sources,
      query,
      count,
      proxyMode,
      proxyManager,
      shared,
      control,
      onLog,
    });

    onProgress({ found_count: seenNorm.size });

    if (!allItems.length) {
      throw new Error(
        "No images found. Try different keywords, enable Auto mode, or use proxy for blocked regions."
      );
    }

    if (reviewMode) {
      onLog(
        "success",
        "Review ready",
        `${allItems.length} URL(s) collected — pick which images to download`
      );
      onProgress({ candidates: allItems });
      return {
        status: "awaiting_review",
        found_count: allItems.length,
        success_count: 0,
        failed_count: 0,
        candidates: allItems,
        failure_reason: null,
      };
    }

    onLog(
      "info",
      `Phase 2 — downloading`,
      `${allItems.length} candidates · target ${count} images`
    );

    const byPlatform = new Map();
    for (const item of allItems) {
      if (!byPlatform.has(item.platform)) byPlatform.set(item.platform, []);
      byPlatform.get(item.platform).push(item);
    }

    for (const platformId of sources) {
      control.check();
      if (state.success >= count) break;

      const batch = byPlatform.get(platformId) ?? [];
      if (!batch.length) continue;

      let browser = null;
      let page = null;
      let rotation = null;

      try {
        ({ browser, page, rotation } = await openSession({
          proxyMode,
          proxyManager,
          platformId,
          onLog,
          shared,
          control,
        }));

        const referer = batch[0].referer;
        await primePage(page, referer);

        await downloadBatch({
          browser,
          searchPage: page,
          items: batch,
          count,
          parallelDownloads: concurrency,
          referer,
          jobDir,
          control,
          state,
          mutex,
          onLog,
          onProgress,
        });
      } finally {
        if (proxyMode && browser) {
          control.untrackBrowser(browser);
          await browser.close().catch(() => {});
          if (rotation) {
            proxyManager.completeRotation(rotation.entry, { status: "ok" });
          }
        }
      }
    }

    if (!proxyMode && shared.browser) {
      control.untrackBrowser(shared.browser);
      await shared.browser.close().catch(() => {});
    }

    control.check();

    if (state.skippedDuplicates > 0) {
      onLog("info", `Removed ${state.skippedDuplicates} duplicate(s)`, "Content-hash dedup");
    }

    if (proxyMode && proxyManager) {
      const report = proxyManager.buildReport();
      onLog(
        "info",
        "Proxy summary",
        `${report.summary.rotationsUsed} rotation(s) · ${report.summary.uniqueEgressIps} unique IP(s)`
      );
    }

    if (state.success === 0) {
      throw new Error(
        `All downloads failed or were duplicates (${state.failed} failed). Try proxy mode or different platforms.`
      );
    }

    const status = state.success < count || state.failed > 0 ? "partial" : "completed";
    onLog(
      status === "completed" ? "success" : "warn",
      `Job finished — ${state.success} saved, ${state.failed} failed, ${state.skippedDuplicates} dupes skipped`,
      `storage/downloads/${jobId}/`
    );

    return {
      status,
      found_count: seenNorm.size,
      success_count: state.success,
      failed_count: state.failed,
      proxyReport: proxyMode && proxyManager ? proxyManager.buildReport() : null,
      failure_reason:
        state.success < count
          ? `Only ${state.success} distinct images saved (requested ${count}).`
          : state.failed > 0
            ? `${state.failed} image(s) could not be downloaded (see activity log)`
            : null,
    };
  } catch (err) {
    if (!(err instanceof JobCancelledError) && !proxyMode && shared.browser) {
      control.untrackBrowser(shared.browser);
      await shared.browser.close().catch(() => {});
    }
    if (err instanceof JobCancelledError) throw err;
    onLog("error", "Job failed", err.message);
    throw err;
  }
}

export async function runSelectedDownloads({
  jobId,
  items,
  proxyMode,
  proxyManager,
  parallelDownloads = 1,
  successOffset = 0,
  control,
  onLog,
  onProgress,
}) {
  const jobDir = join(paths.storage, jobId);
  mkdirSync(jobDir, { recursive: true });

  const shared = { browser: null, page: null };
  const state = {
    success: successOffset,
    failed: 0,
    skippedDuplicates: 0,
    seenContentHashes: new Set(),
  };
  const mutex = createMutex();
  const concurrency = Math.min(
    config.maxDownloadConcurrency,
    Math.max(1, Number(parallelDownloads) || 1)
  );

  const byPlatform = new Map();
  for (const item of items) {
    if (!byPlatform.has(item.platform)) byPlatform.set(item.platform, []);
    byPlatform.get(item.platform).push(item);
  }

  try {
    onLog(
      "info",
      "Downloading selected",
      `${items.length} image(s) · ${concurrency} parallel`
    );

    for (const [platformId, batch] of byPlatform) {
      control.check();

      let browser = null;
      let page = null;
      let rotation = null;

      try {
        ({ browser, page, rotation } = await openSession({
          proxyMode,
          proxyManager,
          platformId,
          onLog,
          shared,
          control,
        }));

        const referer = batch[0].referer;
        await primePage(page, referer);

        await downloadBatch({
          browser,
          searchPage: page,
          items: batch,
          count: successOffset + items.length,
          parallelDownloads: concurrency,
          referer,
          jobDir,
          control,
          state,
          mutex,
          onLog,
          onProgress,
        });
      } finally {
        if (proxyMode && browser) {
          control.untrackBrowser(browser);
          await browser.close().catch(() => {});
          if (rotation) {
            proxyManager.completeRotation(rotation.entry, { status: "ok" });
          }
        }
      }
    }

    if (!proxyMode && shared.browser) {
      control.untrackBrowser(shared.browser);
      await shared.browser.close().catch(() => {});
    }

    const savedNow = state.success - successOffset;
    const status = state.failed > 0 && savedNow === 0 ? "failed" : "completed";
    onLog(
      savedNow ? "success" : "warn",
      `Selected download finished — ${savedNow} saved, ${state.failed} failed`,
      `storage/downloads/${jobId}/`
    );

    return {
      status,
      success_count: state.success,
      failed_count: state.failed,
      failure_reason:
        state.failed > 0
          ? `${state.failed} selected image(s) could not be downloaded`
          : null,
    };
  } catch (err) {
    if (!(err instanceof JobCancelledError) && !proxyMode && shared.browser) {
      control.untrackBrowser(shared.browser);
      await shared.browser.close().catch(() => {});
    }
    throw err;
  }
}
