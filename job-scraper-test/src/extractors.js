export async function extractLinkedInJobsFromPage(page) {
  return page.evaluate(() => {
    const cardSelectors = [
      ".jobs-search-results-list > li",
      ".jobs-search__results-list > li",
      "li[data-occludable-job-id]",
      ".scaffold-layout__list-container li",
      ".base-card",
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > cards.length) cards = found;
    }

    const jobs = [];

    for (const card of cards) {
      const link =
        card.querySelector("a[href*='/jobs/view/']") ||
        card.querySelector("a.base-card__full-link") ||
        card.querySelector("a.job-card-container__link");
      const titleEl =
        card.querySelector(".base-search-card__title") ||
        card.querySelector(".job-card-list__title") ||
        card.querySelector("h3");
      const companyEl =
        card.querySelector(".base-search-card__subtitle") ||
        card.querySelector(".job-card-container__company-name") ||
        card.querySelector("h4");
      const locationEl =
        card.querySelector(".job-card-container__metadata-item") ||
        card.querySelector(".base-search-card__metadata");

      const href = link?.href?.split("?")[0] ?? null;
      const title =
        titleEl?.textContent?.trim() || link?.textContent?.trim() || null;
      const company = companyEl?.textContent?.trim() ?? null;
      const location = locationEl?.textContent?.trim() ?? null;

      if (!title && !href) continue;
      jobs.push({ title, company, location, url: href });
    }

    return jobs;
  });
}

export async function extractIndeedJobsFromPage(page) {
  return page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll(
        ".job_seen_beacon, .jobsearch-ResultsList > li, [data-jk]"
      ),
    ];

    const jobs = [];

    for (const card of cards) {
      const titleEl =
        card.querySelector("h2.jobTitle span[title]") ||
        card.querySelector("h2.jobTitle a span") ||
        card.querySelector("a.jcs-JobTitle") ||
        card.querySelector("[data-testid='job-title']") ||
        card.querySelector("h2.jobTitle a") ||
        card.querySelector("h2 a");
      const companyEl = card.querySelector(
        '[data-testid="company-name"], .companyName'
      );
      const locationEl = card.querySelector(
        '[data-testid="text-location"], .companyLocation'
      );
      const link = card.querySelector(
        "h2.jobTitle a, a.jcs-JobTitle, a[data-jk], a[href*='viewjob'], a[href*='jk=']"
      );

      const title =
        titleEl?.getAttribute("title")?.trim() ||
        titleEl?.textContent?.trim() ||
        link?.getAttribute("aria-label")?.trim() ||
        link?.textContent?.trim() ||
        null;
      const company = companyEl?.textContent?.trim() ?? null;
      const location = locationEl?.textContent?.trim() ?? null;
      let href = link?.href ?? null;
      const jk = card.getAttribute("data-jk");
      if (!href && jk) {
        href = `${window.location.origin}/viewjob?jk=${jk}`;
      }
      if (href?.startsWith("/")) {
        href = `${window.location.origin}${href}`;
      }

      if (!title && !href) continue;
      jobs.push({ title, company, location, url: href });
    }

    return jobs;
  });
}

export async function scrollResultsList(page, site) {
  await page.evaluate((siteName) => {
    const selectors =
      siteName === "linkedin"
        ? [
            ".jobs-search-results-list",
            ".scaffold-layout__list",
            ".jobs-search__results-list",
            "main",
          ]
        : ["#mosaic-jobResults", ".jobsearch-LeftPane", "main"];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollTop = el.scrollHeight;
        el.scrollBy(0, 800);
        return;
      }
    }
    window.scrollBy(0, 900);
  }, site);

  await page.keyboard.press("End").catch(() => {});
}
