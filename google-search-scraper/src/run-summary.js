export function buildRunSummary({
  status,
  totalCollected,
  maxResults,
  pagesScraped = 0,
  error = null,
  filters = {},
  block = null,
}) {
  const target = maxResults ?? 0;
  const collected = totalCollected ?? 0;
  const percent =
    target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 0;

  let outcome = "success";
  let title = "Success";
  const lines = [];

  if (status === "blocked") {
    outcome = "failed";
    title = "Blocked";
    lines.push("Google returned CAPTCHA, consent wall, or rate limit.");
    if (block?.reasons?.length) {
      lines.push(`Signals: ${block.reasons.join(", ")}`);
    }
  } else if (status === "error") {
    outcome = "failed";
    title = "Error";
    lines.push(error || "An unexpected error stopped the run.");
  } else if (status === "cancelled") {
    outcome = "cancelled";
    title = "Cancelled";
    lines.push(`Run cancelled. Saved ${collected} result(s) before stop.`);
  } else if (status === "disconnected") {
    outcome = "partial";
    title = "Disconnected";
    lines.push("Stream disconnected. Check history for saved results.");
  } else if (collected === 0) {
    outcome = "failed";
    title = "No results";
    lines.push("Zero results parsed. Check query, blocks, or selectors.");
  } else if (filters.scrapeAll && status === "completed") {
    outcome = "success";
    title = "Scraped to end";
    lines.push(
      `Collected ${collected} results across ${pagesScraped} page(s) — reached end of Google results.`
    );
  } else if (collected >= target && target > 0) {
    outcome = "success";
    title = "Success";
    lines.push(`Collected ${collected} of ${target} requested (${percent}%).`);
  } else if (collected > 0) {
    outcome = "partial";
    title = "Partial success";
    lines.push(
      `Collected ${collected}${target ? ` of ${target}` : ""} (${pagesScraped} pages).`
    );
    if (status === "plateau") {
      lines.push("No more pages available — reached end of results.");
    }
  }

  if (filters.query) lines.push(`Query: "${filters.query}"`);
  if (filters.location) lines.push(`Location bias: ${filters.location}`);

  const withWebsite = collected; // placeholder — caller can pass stats
  void withWebsite;

  return {
    outcome,
    title,
    diagnosis: lines.join("\n"),
    target,
    collected,
    percent,
    status,
    pagesScraped,
  };
}
