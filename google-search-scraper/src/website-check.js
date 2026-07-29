const AGGREGATOR_DOMAINS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "yelp.com",
  "google.com",
  "maps.google.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "crunchbase.com",
  "glassdoor.com",
  "indeed.com",
  "yellowpages.com",
  "bbb.org",
  "trustpilot.com",
  "amazon.com",
  "wikipedia.org",
  "reddit.com",
  "tripadvisor.com",
  "foursquare.com",
  "mapquest.com",
  "zoominfo.com",
  "bloomberg.com",
  "justdial.com",
  "indiamart.com",
  "sulekha.com",
];

function normalizeHost(hostname) {
  return (hostname ?? "").replace(/^www\./i, "").toLowerCase();
}

function isAggregatorHost(host) {
  return AGGREGATOR_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

export function classifyWebsite(url) {
  try {
    const parsed = new URL(url);
    const host = normalizeHost(parsed.hostname);
    const isAggregator = isAggregatorHost(host);
    return {
      domain: host,
      hasWebsite: !isAggregator,
      websiteType: isAggregator ? "directory_or_social" : "company_site",
    };
  } catch {
    return {
      domain: "",
      hasWebsite: false,
      websiteType: "unknown",
    };
  }
}
