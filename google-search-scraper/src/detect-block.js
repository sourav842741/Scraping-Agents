export async function detectGoogleBlock(page) {
  const signals = await page.evaluate(() => {
    const title = document.title?.toLowerCase() ?? "";
    const bodyText = (document.body?.innerText ?? "").slice(0, 12000).toLowerCase();
    const url = location.href.toLowerCase();

    const checks = {
      captcha:
        url.includes("/sorry/") ||
        bodyText.includes("unusual traffic") ||
        bodyText.includes("not a robot") ||
        bodyText.includes("verify you are human") ||
        bodyText.includes("captcha") ||
        !!document.querySelector(
          'iframe[src*="captcha"], #captcha, .g-recaptcha, form#captcha-form'
        ),
      consent:
        bodyText.includes("before you continue to google") ||
        bodyText.includes("accept all") && bodyText.includes("reject all"),
      rateLimit:
        bodyText.includes("429") ||
        bodyText.includes("too many requests") ||
        title.includes("429") ||
        title.includes("403"),
      emptyResults:
        !document.querySelector("#search, div#rso, div.g") &&
        bodyText.length < 500,
    };

    return { checks, title: document.title, url: location.href };
  });

  const reasons = Object.entries(signals.checks)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return {
    blocked: reasons.length > 0,
    reasons,
    pageTitle: signals.title,
    finalUrl: signals.url,
  };
}
