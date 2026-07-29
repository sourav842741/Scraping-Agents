/**
 * Build human-readable outcome + diagnosis for a scrape run.
 */
export function buildRunSummary({
  status,
  totalCollected,
  quantity,
  sites = [],
  siteResults = {},
  error = null,
  filters = {},
}) {
  const perSite = quantity ?? 0;
  const target = perSite * sites.length;
  const collected = totalCollected ?? 0;
  const percent =
    target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 0;

  let outcome = "success";
  let title = "Success";
  const lines = [];

  if (status === "blocked") {
    outcome = "failed";
    title = "Blocked";
    lines.push("The site returned a login wall, CAPTCHA, or rate limit.");
    const blocked = Object.entries(siteResults).filter(([, r]) => r.block?.blocked);
    for (const [site, r] of blocked) {
      lines.push(`${site}: ${r.block.reasons?.join(", ") ?? "blocked"}`);
    }
  } else if (status === "error") {
    outcome = "failed";
    title = "Error";
    lines.push(error || "An unexpected error stopped the run.");
  } else if (status === "cancelled") {
    outcome = "cancelled";
    title = "Cancelled";
    lines.push(`Run was cancelled. Saved ${collected} job(s) collected before stop.`);
  } else if (status === "disconnected") {
    outcome = "partial";
    title = "Disconnected";
    lines.push(
      "Browser stream disconnected. Server may have continued briefly; check history file."
    );
  } else if (status === "plateau" || (collected > 0 && collected < target * 0.9)) {
    outcome = "partial";
    title = collected === 0 ? "No jobs found" : "Partial — plateau";
    lines.push(
      `Collected ${collected} of ${target} requested (${percent}%).`
    );
    lines.push(
      "LinkedIn/Indeed often stop loading new listings for guest search — especially with narrow filters."
    );
    if (filters.keywords) lines.push(`Keywords: "${filters.keywords}"`);
    if (filters.location) lines.push(`Location: ${filters.location}`);
    if (filters.postedWithin)
      lines.push(`Posted within: ${filters.postedWithin}`);
  } else if (collected === 0) {
    outcome = "failed";
    title = "No results";
    lines.push("Zero jobs parsed. Check filters, login walls, or selectors.");
  } else if (collected >= target) {
    outcome = "success";
    title = "Success";
    lines.push(`Collected ${collected} jobs (target ${target}).`);
  } else {
    outcome = "partial";
    title = "Partial success";
    lines.push(`Collected ${collected} of ${target} (${percent}%).`);
  }

  for (const site of sites) {
    const r = siteResults[site];
    if (!r) continue;
    const c = r.count ?? 0;
    const ok = r.ok ? "ok" : "issues";
    lines.push(`${site}: ${c}/${perSite} jobs (${ok})`);
    if (r.error) lines.push(`  → ${r.error}`);
  }

  return {
    outcome,
    title,
    diagnosis: lines.join("\n"),
    target,
    collected,
    percent,
    status,
  };
}
