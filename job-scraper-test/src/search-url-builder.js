/**
 * Build LinkedIn / Indeed search URLs from structured filters.
 * @see POSTED_WITHIN_OPTIONS, LINKEDIN_EXPERIENCE, INDEED_EXPERIENCE
 */

export const POSTED_WITHIN_OPTIONS = [
  { id: "any", label: "Any time" },
  { id: "1h", label: "Past hour" },
  { id: "24h", label: "Past 24 hours" },
  { id: "3d", label: "Past 3 days" },
  { id: "7d", label: "Past week" },
  { id: "14d", label: "Past 2 weeks" },
  { id: "30d", label: "Past month" },
  { id: "custom", label: "Custom hours" },
];

export const WORK_TYPE_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];

export const SORT_OPTIONS = [
  { id: "relevance", label: "Relevance" },
  { id: "date", label: "Newest first" },
];

/** LinkedIn f_E experience levels */
export const LINKEDIN_EXPERIENCE_OPTIONS = [
  { id: "any", label: "Any level" },
  { id: "intern", label: "Internship", f_E: "1" },
  { id: "entry", label: "Entry / Fresher", f_E: "2" },
  { id: "associate", label: "Associate", f_E: "3" },
  { id: "mid", label: "Mid-Senior", f_E: "4" },
  { id: "director", label: "Director", f_E: "5" },
  { id: "executive", label: "Executive", f_E: "6" },
];

/** Indeed explvl */
export const INDEED_EXPERIENCE_OPTIONS = [
  { id: "any", label: "Any level" },
  { id: "entry", label: "Entry / Fresher", explvl: "entry_level" },
  { id: "mid", label: "Mid level", explvl: "mid_level" },
  { id: "senior", label: "Senior", explvl: "senior_level" },
];

export const INDEED_JOB_TYPE_OPTIONS = [
  { id: "any", label: "Any type" },
  { id: "fulltime", label: "Full-time", jt: "fulltime" },
  { id: "parttime", label: "Part-time", jt: "parttime" },
  { id: "contract", label: "Contract", jt: "contract" },
  { id: "internship", label: "Internship", jt: "internship" },
  { id: "temporary", label: "Temporary", jt: "temporary" },
];

const PRESET_LINKEDIN_TPR = {
  "1h": "r3600",
  "24h": "r86400",
  "3d": "r259200",
  "7d": "r604800",
  "14d": "r1209600",
  "30d": "r2592000",
};

const PRESET_INDEED_FROMAGE = {
  "1h": "1",
  "24h": "1",
  "3d": "3",
  "7d": "7",
  "14d": "14",
  "30d": "14",
};

const LINKEDIN_WT = { remote: "2", hybrid: "3", onsite: "1" };
/** Raw values — URLSearchParams encodes once (avoid double-encoding %253A). */
const INDEED_REMOTE_SC = "0kf:attr(DSQF7);";
const INDEED_HYBRID_SC = "0kf:attr(PAXZC);";

export function resolveTimeFilters(postedWithin, customHours) {
  if (postedWithin === "custom") {
    const hours = Math.min(720, Math.max(1, Number(customHours) || 24));
    const seconds = Math.round(hours * 3600);
    const days = Math.min(14, Math.max(1, Math.ceil(hours / 24)));
    return {
      linkedinTpr: `r${seconds}`,
      indeedFromage: String(days),
      label: `Custom ${hours}h`,
    };
  }

  if (postedWithin === "any") {
    return { linkedinTpr: null, indeedFromage: null, label: "Any time" };
  }

  return {
    linkedinTpr: PRESET_LINKEDIN_TPR[postedWithin] ?? null,
    indeedFromage: PRESET_INDEED_FROMAGE[postedWithin] ?? null,
    label: POSTED_WITHIN_OPTIONS.find((o) => o.id === postedWithin)?.label ?? postedWithin,
  };
}

export function buildLinkedInSearchUrl(filters = {}) {
  const {
    keywords = "",
    location = "",
    postedWithin = "any",
    customHours = 24,
    workType = "any",
    experience = "any",
    sort = "date",
  } = filters;

  const params = new URLSearchParams();
  const kw = keywords.trim();
  const loc = location.trim();

  if (kw) params.set("keywords", kw);
  if (loc) params.set("location", loc);

  const time = resolveTimeFilters(postedWithin, customHours);
  if (time.linkedinTpr) params.set("f_TPR", time.linkedinTpr);

  if (workType !== "any" && LINKEDIN_WT[workType]) {
    params.set("f_WT", LINKEDIN_WT[workType]);
  }

  const exp = LINKEDIN_EXPERIENCE_OPTIONS.find((o) => o.id === experience);
  if (exp?.f_E) params.set("f_E", exp.f_E);

  if (sort === "date") params.set("sortBy", "DD");

  const qs = params.toString();
  return qs
    ? `https://www.linkedin.com/jobs/search/?${qs}`
    : "https://www.linkedin.com/jobs/search/";
}

export function buildIndeedSearchUrl(filters = {}) {
  const {
    keywords = "",
    location = "",
    postedWithin = "any",
    customHours = 24,
    workType = "any",
    experience = "any",
    jobType = "any",
    sort = "date",
  } = filters;

  const params = new URLSearchParams();
  const kw = keywords.trim();
  const loc = location.trim();

  if (kw) params.set("q", kw);
  if (loc) params.set("l", loc);

  const time = resolveTimeFilters(postedWithin, customHours);
  if (time.indeedFromage) params.set("fromage", time.indeedFromage);

  if (sort === "date") params.set("sort", "date");

  if (workType === "remote") params.set("sc", INDEED_REMOTE_SC);
  else if (workType === "hybrid") params.set("sc", INDEED_HYBRID_SC);

  const exp = INDEED_EXPERIENCE_OPTIONS.find((o) => o.id === experience);
  if (exp?.explvl) params.set("explvl", exp.explvl);

  const jt = INDEED_JOB_TYPE_OPTIONS.find((o) => o.id === jobType);
  if (jt?.jt) params.set("jt", jt.jt);

  const qs = params.toString();
  return qs
    ? `https://www.indeed.com/jobs?${qs}`
    : "https://www.indeed.com/jobs";
}

export function buildSearchUrls(filters) {
  const linkedinLoc = filters.separateLocations
    ? filters.linkedinLocation || filters.location
    : filters.location;
  const indeedLoc = filters.separateLocations
    ? filters.indeedLocation || filters.location
    : filters.location;

  return {
    linkedin: buildLinkedInSearchUrl({
      ...filters,
      location: linkedinLoc,
      workType: filters.linkedinWorkType ?? filters.workType ?? "any",
      experience: filters.linkedinExperience ?? "any",
    }),
    indeed: buildIndeedSearchUrl({
      ...filters,
      location: indeedLoc,
      workType: filters.indeedWorkType ?? filters.workType ?? "any",
      experience: filters.indeedExperience ?? "any",
      jobType: filters.indeedJobType ?? "any",
    }),
  };
}

export function parseExtractFilters(query) {
  const quantity = Math.min(1000, Math.max(1, Number(query.quantity) || 25));

  const filters = {
    keywords: String(query.keywords ?? "").trim(),
    location: String(query.location ?? "").trim(),
    separateLocations: query.separateLocations === "true",
    linkedinLocation: String(query.linkedinLocation ?? query.location ?? "").trim(),
    indeedLocation: String(query.indeedLocation ?? query.location ?? "").trim(),
    postedWithin: String(query.postedWithin ?? "24h"),
    customHours: String(query.customHours ?? "24"),
    sort: String(query.sort ?? "date"),
    linkedinWorkType: String(query.linkedinWorkType ?? "any"),
    indeedWorkType: String(query.indeedWorkType ?? "any"),
    linkedinExperience: String(query.linkedinExperience ?? "any"),
    indeedExperience: String(query.indeedExperience ?? "any"),
    indeedJobType: String(query.indeedJobType ?? "any"),
  };

  const useCustomUrls =
    query.useCustomUrls === "true" &&
    (query.linkedinUrl || query.indeedUrl);

  let linkedinUrl = query.linkedinUrl?.trim() || "";
  let indeedUrl = query.indeedUrl?.trim() || "";

  if (!useCustomUrls) {
    const built = buildSearchUrls(filters);
    linkedinUrl = linkedinUrl || built.linkedin;
    indeedUrl = indeedUrl || built.indeed;
  }

  return {
    quantity,
    filters,
    linkedinUrl,
    indeedUrl,
    built: buildSearchUrls(filters),
  };
}
