export const POSTED_OPTIONS = [
  { id: "any", label: "Any time" },
  { id: "1h", label: "Past hour" },
  { id: "24h", label: "24 hours" },
  { id: "3d", label: "3 days" },
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom hours" },
];

export const WORK_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];

export const SORT_OPTIONS = [
  { id: "date", label: "Newest" },
  { id: "relevance", label: "Relevance" },
];

export const LINKEDIN_EXP_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "intern", label: "Internship" },
  { id: "entry", label: "Fresher / Entry" },
  { id: "associate", label: "Associate" },
  { id: "mid", label: "Mid-Senior" },
  { id: "director", label: "Director" },
  { id: "executive", label: "Executive" },
];

export const INDEED_EXP_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "entry", label: "Fresher / Entry" },
  { id: "mid", label: "Mid level" },
  { id: "senior", label: "Senior" },
];

export const INDEED_JOB_TYPE_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "fulltime", label: "Full-time" },
  { id: "parttime", label: "Part-time" },
  { id: "contract", label: "Contract" },
  { id: "internship", label: "Internship" },
  { id: "temporary", label: "Temporary" },
];

export function buildFilterParams(state) {
  const p = {
    keywords: state.keywords,
    location: state.location,
    separateLocations: state.separateLocations ? "true" : "false",
    linkedinLocation: state.linkedinLocation,
    indeedLocation: state.indeedLocation,
    postedWithin: state.postedWithin,
    customHours: String(state.customHours),
    sort: state.sort,
    linkedinWorkType: state.linkedinWorkType,
    indeedWorkType: state.indeedWorkType,
    linkedinExperience: state.linkedinExperience,
    indeedExperience: state.indeedExperience,
    indeedJobType: state.indeedJobType,
  };
  return p;
}

export async function fetchBuiltUrls(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/build-urls?${qs}`);
  if (!res.ok) throw new Error("Failed to build URLs");
  return res.json();
}
