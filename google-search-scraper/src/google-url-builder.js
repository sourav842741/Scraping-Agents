import { locationToCountryCode } from "./webshare-proxy.js";

const GL_MAP = {
  in: "in",
  us: "us",
  gb: "uk",
  ca: "ca",
  au: "au",
  de: "de",
  fr: "fr",
  br: "br",
  sg: "sg",
  nl: "nl",
  jp: "jp",
  mx: "mx",
  ph: "ph",
  bd: "bd",
  tr: "tr",
  ae: "ae",
};

export function locationToGl(location) {
  const code = locationToCountryCode(location);
  if (!code) return "us";
  return GL_MAP[code] ?? code;
}

export function buildGoogleSearchUrl({
  query,
  location = "",
  start = 0,
  num = 10,
} = {}) {
  const params = new URLSearchParams();
  params.set("q", query.trim());
  params.set("start", String(start));
  params.set("num", String(Math.min(100, Math.max(10, num))));
  params.set("hl", "en");

  const gl = locationToGl(location);
  params.set("gl", gl);

  if (location?.trim()) {
    params.set("near", location.trim());
  }

  return `https://www.google.com/search?${params.toString()}`;
}

export function parseExtractFilters(query = {}) {
  const maxResults = Math.min(
    1000,
    Math.max(10, Number(query.maxResults ?? query.quantity ?? 500) || 500)
  );

  return {
    query: (query.query ?? query.q ?? "").trim(),
    location: (query.location ?? "").trim(),
    maxResults,
    scrapeAll: query.scrapeAll === "true" || query.scrapeAll === true,
    filters: {
      query: (query.query ?? query.q ?? "").trim(),
      location: (query.location ?? "").trim(),
      maxResults,
      scrapeAll: query.scrapeAll === "true" || query.scrapeAll === true,
    },
    built: buildGoogleSearchUrl({
      query: (query.query ?? query.q ?? "").trim(),
      location: (query.location ?? "").trim(),
    }),
  };
}
