import { detectBlock } from "../detect-block.js";
import { goto, newPage, sleep } from "../browser.js";
import { extractLinkedInJobsFromPage } from "../extractors.js";

export async function testLinkedIn(browser, { urls, maxJobsFromSearch, requestDelayMs }) {
  const results = [];
  const page = await newPage(browser);

  const tasks = [];
  if (urls.searchUrl) tasks.push({ type: "search", url: urls.searchUrl });
  for (const url of urls.jobUrls ?? []) {
    tasks.push({ type: "job", url });
  }

  if (tasks.length === 0) {
    return [
      {
        site: "linkedin",
        ok: false,
        error: "No linkedin.searchUrl or linkedin.jobUrls in test-urls.json",
      },
    ];
  }

  for (const task of tasks) {
    const entry = {
      site: "linkedin",
      testType: task.type,
      url: task.url,
      startedAt: new Date().toISOString(),
    };

    try {
      const nav = await goto(page, task.url);
      entry.httpStatus = nav.status;
      entry.finalUrl = nav.finalUrl;

      const block = await detectBlock(page);
      entry.block = block;

      if (task.type === "search") {
        await page
          .waitForSelector(
            ".jobs-search-results-list, .jobs-search__results-list, [data-job-id], .base-card",
            { timeout: 15000 }
          )
          .catch(() => {});
        const all = await extractLinkedInJobsFromPage(page);
        entry.jobs = dedupeJobs(all).slice(0, maxJobsFromSearch);
      } else {
        entry.job = await extractLinkedInJobDetail(page);
      }

      const jobsHaveData = (entry.jobs ?? []).some((j) => j.title || j.company);
      entry.ok =
        !block.blocked &&
        (jobsHaveData || Boolean(entry.job?.title || entry.job?.company));

      if (!entry.ok && !block.blocked) {
        entry.hint =
          "Page loaded but no jobs parsed — likely login wall, changed DOM, or empty search.";
      }
    } catch (err) {
      entry.ok = false;
      entry.error = err.message;
    }

    entry.finishedAt = new Date().toISOString();
    results.push(entry);
    await sleep(requestDelayMs);
  }

  await page.close();
  return results;
}

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const key = j.url || `${j.title}|${j.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function extractLinkedInJobDetail(page) {
  return page.evaluate(() => {
    const title =
      document.querySelector(".job-details-jobs-unified-top-card__job-title h1")?.textContent?.trim() ||
      document.querySelector("h1")?.textContent?.trim() ||
      null;
    const company =
      document.querySelector(
        ".job-details-jobs-unified-top-card__company-name a"
      )?.textContent?.trim() ||
      document.querySelector("[class*='company-name']")?.textContent?.trim() ||
      null;
    const location =
      document.querySelector(
        ".job-details-jobs-unified-top-card__bullet"
      )?.textContent?.trim() || null;

    const description =
      document
        .querySelector(".jobs-description__content, #job-details")
        ?.textContent?.trim()
        ?.slice(0, 500) ?? null;

    return { title, company, location, descriptionPreview: description };
  });
}
