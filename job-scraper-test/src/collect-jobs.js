import { mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { launchBrowser, newPage, goto, sleep } from "./browser.js";
import { detectBlock } from "./detect-block.js";
import { checkProxyEgress } from "./webshare-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotsDir = join(__dirname, "..", "output", "screenshots");
import {
  extractLinkedInJobsFromPage,
  extractIndeedJobsFromPage,
  scrollResultsList,
} from "./extractors.js";

function jobKey(job) {
  return job.url || `${job.title ?? ""}|${job.company ?? ""}`;
}

export async function collectJobs({
  site,
  searchUrl,
  quantity,
  headless = true,
  onEvent,
  signal,
  proxyManager = null,
}) {
  const emit = (type, data) => onEvent?.({ type, ...data });

  let proxyRotation = null;
  if (proxyManager) {
    proxyRotation = proxyManager.rotateForSite(site);
    emit("proxy-rotation", {
      rotation: { ...proxyRotation.entry },
      message: `Proxy rotation #${proxyRotation.entry.index} for ${site} (${proxyRotation.entry.countryLabel})`,
    });
    emit("status", {
      message: `Launching browser for ${site} via Webshare ${proxyRotation.entry.proxyServer}…`,
      phase: "init",
    });
  } else {
    emit("status", { message: `Launching browser for ${site}…`, phase: "init" });
  }

  const browser = await launchBrowser({
    headless,
    proxyServer: proxyRotation?.proxyServer,
  });
  const page = await newPage(browser, {
    proxyAuth: proxyRotation
      ? { username: proxyRotation.username, password: proxyRotation.password }
      : undefined,
  });
  const collected = [];
  const seen = new Set();

  try {
    if (proxyRotation) {
      emit("status", { message: "Checking proxy egress IP…", phase: "proxy-check" });
      const ipCheck = await checkProxyEgress(page);
      proxyManager.completeRotation(proxyRotation.entry, {
        ipCheck,
        scrapeJobs: 0,
        status: ipCheck.ok ? "active" : "ip-check-failed",
      });
      emit("proxy-ip", {
        rotationIndex: proxyRotation.entry.index,
        site,
        ipCheck,
        rotation: { ...proxyRotation.entry },
      });
      if (ipCheck.ok) {
        emit("status", {
          message: `Proxy egress: ${ipCheck.ip ?? "?"} (${ipCheck.city ?? "?"}, ${ipCheck.country ?? "?"})`,
          phase: "proxy-ready",
        });
      } else {
        emit("status", {
          message: `Proxy IP check failed: ${ipCheck.error ?? "unknown"} — continuing scrape`,
          phase: "proxy-warn",
        });
      }
    }

    emit("status", { message: `Loading ${site} search page…`, phase: "navigate" });
    const nav = await goto(page, searchUrl);
    emit("status", {
      message: `Page loaded (HTTP ${nav.status ?? "?"})`,
      phase: "loaded",
      httpStatus: nav.status,
      finalUrl: nav.finalUrl,
    });

    if (nav.status === 403 || nav.status === 429) {
      emit("block", {
        site,
        reasons: [`http_${nav.status}`],
        pageTitle: await page.title().catch(() => ""),
        httpStatus: nav.status,
        finalUrl: nav.finalUrl,
      });
      if (proxyRotation && proxyManager) {
        proxyManager.completeRotation(proxyRotation.entry, {
          scrapeJobs: 0,
          status: "blocked",
        });
        emit("proxy-rotation-complete", { rotation: { ...proxyRotation.entry }, site });
      }
      return {
        site,
        jobs: [],
        ok: false,
        block: { blocked: true, reasons: [`http_${nav.status}`] },
      };
    }

    const block = await detectBlock(page);
    if (block.blocked) {
      emit("block", { site, reasons: block.reasons, pageTitle: block.pageTitle });
      if (proxyRotation && proxyManager) {
        proxyManager.completeRotation(proxyRotation.entry, {
          scrapeJobs: 0,
          status: "blocked",
        });
        emit("proxy-rotation-complete", {
          rotation: { ...proxyRotation.entry },
          site,
        });
      }
      return { site, jobs: [], ok: false, block };
    }

    const waitSel =
      site === "linkedin"
        ? ".jobs-search-results-list, .jobs-search__results-list, [data-job-id], .base-card"
        : ".job_seen_beacon, [data-jk], h2.jobTitle";

    await page.waitForSelector(waitSel, { timeout: 20000 }).catch(() => {});

    mkdirSync(screenshotsDir, { recursive: true });
    const shotName = `${site}-${Date.now()}.jpg`;
    const shotPath = join(screenshotsDir, shotName);
    await page.screenshot({ path: shotPath, type: "jpeg", quality: 72 });
    emit("screenshot", { site, path: `/api/screenshots/${shotName}` });

    let stagnantRounds = 0;
    let pageOffset = 0;
    let paginateAttempts = 0;
    const maxStagnant = Math.min(25, Math.max(8, Math.ceil(quantity / 15)));
    const maxPaginateWithoutGrowth = 6;

    while (collected.length < quantity && stagnantRounds < maxStagnant) {
      if (signal?.aborted) {
        emit("status", { message: "Cancelled", phase: "cancelled" });
        break;
      }

      const batch =
        site === "linkedin"
          ? await extractLinkedInJobsFromPage(page)
          : await extractIndeedJobsFromPage(page);

      let newInRound = 0;
      for (const raw of batch) {
        const key = jobKey(raw);
        if (seen.has(key)) continue;
        seen.add(key);

        const job = {
          id: collected.length + 1,
          site,
          title: raw.title,
          company: raw.company,
          location: raw.location ?? null,
          url: raw.url,
          collectedAt: new Date().toISOString(),
        };
        collected.push(job);
        newInRound++;

        emit("progress", {
          site,
          current: collected.length,
          total: quantity,
          job,
        });

        if (collected.length >= quantity) break;
      }

      if (collected.length >= quantity) break;

      if (newInRound === 0) {
        stagnantRounds++;

        if (
          site === "linkedin" &&
          stagnantRounds % 3 === 0 &&
          paginateAttempts < maxPaginateWithoutGrowth
        ) {
          pageOffset += 25;
          paginateAttempts++;
          const beforePaginate = collected.length;
          const nextUrl = new URL(searchUrl);
          nextUrl.searchParams.set("start", String(pageOffset));
          emit("status", {
            message: `Loading page offset ${pageOffset}…`,
            phase: "paginate",
            current: collected.length,
            total: quantity,
          });
          await goto(page, nextUrl.toString());
          await page.waitForSelector(waitSel, { timeout: 15000 }).catch(() => {});

          const afterBatch =
            site === "linkedin"
              ? await extractLinkedInJobsFromPage(page)
              : await extractIndeedJobsFromPage(page);

          let foundAfterPage = 0;
          for (const raw of afterBatch) {
            const key = jobKey(raw);
            if (seen.has(key)) continue;
            seen.add(key);
            const job = {
              id: collected.length + 1,
              site,
              title: raw.title,
              company: raw.company,
              location: raw.location ?? null,
              url: raw.url,
              collectedAt: new Date().toISOString(),
            };
            collected.push(job);
            foundAfterPage++;
            emit("progress", {
              site,
              current: collected.length,
              total: quantity,
              job,
            });
            if (collected.length >= quantity) break;
          }

          if (foundAfterPage > 0) {
            stagnantRounds = 0;
          } else if (paginateAttempts >= maxPaginateWithoutGrowth) {
            emit("plateau", {
              site,
              collected: collected.length,
              target: quantity,
              message: `LinkedIn returned no new jobs after ${paginateAttempts} page offsets (stuck at ${collected.length}).`,
            });
            break;
          }
        } else if (
          site === "indeed" &&
          stagnantRounds % 3 === 0 &&
          paginateAttempts < maxPaginateWithoutGrowth
        ) {
          paginateAttempts++;
          const start = paginateAttempts * 10;
          const nextUrl = new URL(searchUrl);
          nextUrl.searchParams.set("start", String(start));
          emit("status", {
            message: `Indeed page start=${start}…`,
            phase: "paginate",
            current: collected.length,
            total: quantity,
          });
          await goto(page, nextUrl.toString());
          await page.waitForSelector(waitSel, { timeout: 15000 }).catch(() => {});

          let foundAfterPage = 0;
          const afterBatch = await extractIndeedJobsFromPage(page);
          for (const raw of afterBatch) {
            const key = jobKey(raw);
            if (seen.has(key)) continue;
            seen.add(key);
            const job = {
              id: collected.length + 1,
              site,
              title: raw.title,
              company: raw.company,
              location: raw.location ?? null,
              url: raw.url,
              collectedAt: new Date().toISOString(),
            };
            collected.push(job);
            foundAfterPage++;
            emit("progress", { site, current: collected.length, total: quantity, job });
            if (collected.length >= quantity) break;
          }
          if (foundAfterPage > 0) stagnantRounds = 0;
          else if (paginateAttempts >= maxPaginateWithoutGrowth) {
            emit("plateau", {
              site,
              collected: collected.length,
              target: quantity,
              message: `Indeed returned no new jobs after ${paginateAttempts} pages (stuck at ${collected.length} of ${quantity}).`,
            });
            break;
          }
        } else if (stagnantRounds >= maxStagnant) {
          emit("plateau", {
            site,
            collected: collected.length,
            target: quantity,
            message: `No new listings after ${maxStagnant} scroll rounds (found ${collected.length} of ${quantity}). Guest search limit — not a full ${quantity}.`,
          });
          break;
        }
      } else {
        stagnantRounds = 0;
      }

      if (collected.length >= quantity) break;

      emit("status", {
        message: `Scrolling for more… (${collected.length}/${quantity})`,
        phase: "scroll",
        current: collected.length,
        total: quantity,
      });

      await scrollResultsList(page, site);
      await sleep(quantity > 200 ? 800 : 1200);
    }

    const ok = collected.length > 0;
    if (proxyRotation && proxyManager) {
      proxyManager.completeRotation(proxyRotation.entry, {
        scrapeJobs: collected.length,
        status: ok ? "ok" : "empty",
      });
      emit("proxy-rotation-complete", {
        rotation: { ...proxyRotation.entry },
        site,
      });
    }
    emit("done", { site, ok, count: collected.length, total: quantity });
    return { site, jobs: collected, ok, block: null };
  } catch (err) {
    if (proxyRotation && proxyManager) {
      proxyManager.completeRotation(proxyRotation.entry, {
        scrapeJobs: collected.length,
        status: "error",
      });
    }
    emit("error", { site, message: err.message });
    return { site, jobs: collected, ok: false, error: err.message };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
