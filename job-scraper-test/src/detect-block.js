export async function detectBlock(page) {
  const signals = await page.evaluate(() => {
    const title = document.title?.toLowerCase() ?? "";
    const bodyText = (document.body?.innerText ?? "").slice(0, 8000).toLowerCase();
    const url = location.href.toLowerCase();

    const checks = {
      loginWall:
        url.includes("/login") ||
        url.includes("authwall") ||
        url.includes("uas/login") ||
        title.includes("sign in") ||
        title.includes("log in") ||
        bodyText.includes("sign in to linkedin") ||
        bodyText.includes("join linkedin"),
      captcha:
        bodyText.includes("captcha") ||
        bodyText.includes("verify you are human") ||
        bodyText.includes("security check") ||
        !!document.querySelector('iframe[src*="captcha"], #captcha, .g-recaptcha'),
      rateLimit:
        bodyText.includes("too many requests") ||
        bodyText.includes("rate limit") ||
        bodyText.includes("403 forbidden") ||
        bodyText.includes("access denied") ||
        title.includes("429") ||
        title.includes("403"),
      emptyResults:
        bodyText.length < 200 &&
        !document.querySelector("main, [role=main], .jobs-search-results-list"),
    };

    return { checks, title: document.title, url: location.href };
  });

  const blocked = Object.entries(signals.checks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return {
    blocked: blocked.length > 0,
    reasons: blocked,
    pageTitle: signals.title,
    finalUrl: signals.url,
  };
}
