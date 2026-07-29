import { detectBlock } from "../detect-block.js";
import { goto, newPage, sleep } from "../browser.js";
import { extractIndeedJobsFromPage } from "../extractors.js";

export async function testIndeed(browser, { urls, maxJobsFromSearch, requestDelayMs }) {
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
        site: "indeed",
        ok: false,
        error: "No indeed.searchUrl or indeed.jobUrls in test-urls.json",
      },
    ];
  }

  for (const task of tasks) {
    const entry = {
      site: "indeed",
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
            ".job_seen_beacon, [data-jk], h2.jobTitle, [data-testid='job-title']",
            { timeout: 15000 }
          )
          .catch(() => {});
        const all = await extractIndeedJobsFromPage(page);
        entry.jobs = dedupeJobs(all).slice(0, maxJobsFromSearch);
      } else {
        entry.job = await extractIndeedJobDetail(page);
      }

      const jobsHaveData = (entry.jobs ?? []).some((j) => j.title || j.company);
      entry.ok =
        !block.blocked &&
        (jobsHaveData || Boolean(entry.job?.title || entry.job?.company));

      if (!entry.ok && !block.blocked) {
        entry.hint =
          "Page loaded but no jobs parsed — selectors may have changed or page is gated.";
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

async function extractIndeedJobDetail(page) {
  return page.evaluate(() => {
    const title =
      document.querySelector("h1.jobTitle, [data-testid='jobsearch-JobInfoHeader-title']")
        ?.textContent?.trim() || null;
    const company =
      document.querySelector(
        "[data-company-name='true'], .jobsearch-InlineCompanyRating a"
      )?.textContent?.trim() || null;
    const location =
      document.querySelector(
        "[data-testid='job-location'], .jobsearch-JobInfoHeader-subtitle div"
      )?.textContent?.trim() || null;

    const description =
      document
        .querySelector("#jobDescriptionText, [id*='jobDescription']")
        ?.textContent?.trim()
        ?.slice(0, 500) ?? null;

    return { title, company, location, descriptionPreview: description };
  });
}
