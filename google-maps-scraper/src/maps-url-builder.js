export function buildGoogleMapsSearchUrl({ query, location = "" } = {}) {
  const term = location?.trim() ? `${query} in ${location.trim()}` : query;
  const encoded = encodeURIComponent(term).replace(/%20/g, "+");
  return `https://www.google.com/maps/search/${encoded}`;
}
