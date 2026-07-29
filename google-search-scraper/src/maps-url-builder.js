export function buildGoogleMapsSearchUrl({ query, location = "" } = {}) {
  const term = location?.trim() ? `${query} in ${location.trim()}` : query;
  const encoded = encodeURIComponent(term).replace(/%20/g, "+");
  return `https://www.google.com/maps/search/${encoded}`;
}

export function parseMapsCliArgs(argv = process.argv.slice(2)) {
  const opts = {
    query: "digital marketing agency",
    location: "India",
    maxResults: 100,
    maxScrolls: 50,
    maxRotations: 15,
    unlimited: false,
    headless: true,
    proxy: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--query" || arg === "-q") opts.query = argv[++i] ?? opts.query;
    else if (arg === "--location" || arg === "-l") opts.location = argv[++i] ?? opts.location;
    else if (arg === "--max" || arg === "-m") opts.maxResults = Number(argv[++i]) || opts.maxResults;
    else if (arg === "--scrolls") opts.maxScrolls = Number(argv[++i]) || opts.maxScrolls;
    else if (arg === "--max-rotations") opts.maxRotations = Number(argv[++i]) || opts.maxRotations;
    else if (arg === "--unlimited" || arg === "--all") opts.unlimited = true;
    else if (arg === "--no-proxy") opts.proxy = false;
    else if (arg === "--headed") opts.headless = false;
    else if (arg === "--help" || arg === "-h") opts.help = true;
  }

  return {
    ...opts,
    built: buildGoogleMapsSearchUrl({ query: opts.query, location: opts.location }),
  };
}
