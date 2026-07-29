import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const DOCS = {
  provider: "Webshare",
  website: "https://webshare.io/",
  apiDocs: "https://proxy.webshare.io/api/v2/",
  apiKeysPage: "https://proxy.webshare.io/",
};

const LOCATION_COUNTRY = {
  india: "in",
  "united states": "us",
  usa: "us",
  "united kingdom": "gb",
  uk: "gb",
  canada: "ca",
  australia: "au",
  germany: "de",
  france: "fr",
  brazil: "br",
  singapore: "sg",
  netherlands: "nl",
  japan: "jp",
  mexico: "mx",
  philippines: "ph",
  bangladesh: "bd",
  turkey: "tr",
  uae: "ae",
  "united arab emirates": "ae",
};

let envLoaded = false;

export function loadProxyEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_BASE = "https://proxy.webshare.io/api/v2";

export function getApiKey() {
  loadProxyEnv();
  return process.env.WEBSHARE_API_KEY?.trim() || null;
}

export function hasExplicitProxyCredentials() {
  loadProxyEnv();
  return Boolean(
    process.env.WEBSHARE_PROXY_USER?.trim() &&
      process.env.WEBSHARE_PROXY_PASSWORD?.trim()
  );
}

export function isProxyConfigured() {
  return Boolean(getApiKey() || hasExplicitProxyCredentials());
}

export function getProxyPublicConfig() {
  loadProxyEnv();
  const apiKey = getApiKey();
  const explicit = hasExplicitProxyCredentials();
  return {
    configured: isProxyConfigured(),
    authMode: apiKey && !explicit ? "api_key" : explicit ? "proxy_credentials" : null,
    provider: DOCS.provider,
    docs: DOCS,
    envHint: "Set WEBSHARE_API_KEY in .env (get from https://proxy.webshare.io/)",
  };
}

export function locationToCountryCode(location) {
  if (!location || typeof location !== "string") return null;
  const key = location.trim().toLowerCase();
  if (LOCATION_COUNTRY[key]) return LOCATION_COUNTRY[key];
  for (const [name, code] of Object.entries(LOCATION_COUNTRY)) {
    if (key.includes(name)) return code;
  }
  const m = key.match(/\b([a-z]{2})\b$/);
  if (m && m[1].length === 2) return m[1];
  return null;
}

/** Webshare free tier doesn't support credentials resolution via API like NodeMaven.
 *  This returns the first proxy from the pool for compatibility. */
export async function resolveWebshareCredentials({ forceRefresh } = {}) {
  loadProxyEnv();

  if (hasExplicitProxyCredentials()) {
    return {
      baseUser: process.env.WEBSHARE_PROXY_USER.trim(),
      password: process.env.WEBSHARE_PROXY_PASSWORD.trim(),
      source: "env",
      account: null,
    };
  }

  const proxyList = await fetchProxyList({ forceRefresh });
  const first = proxyList[0];
  return {
    baseUser: first.username,
    password: first.password,
    source: "api",
    account: null,
  };
}

/** Alias for backward compatibility */
export const resolveNodeMavenCredentials = resolveWebshareCredentials;

let proxyListCache = null;
let proxyListCacheAt = 0;
const PROXY_LIST_TTL = 5 * 60 * 1000;

export async function fetchProxyList({ forceRefresh = false } = {}) {
  loadProxyEnv();
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Webshare not configured: set WEBSHARE_API_KEY in .env");
  }

  if (
    !forceRefresh &&
    proxyListCache &&
    Date.now() - proxyListCacheAt < PROXY_LIST_TTL
  ) {
    return proxyListCache;
  }

  const allProxies = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${API_BASE}/proxy/list/?mode=direct&page=${page}&page_size=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Webshare API ${res.status}: ${body.slice(0, 200) || res.statusText}. Check API key.`
      );
    }

    const data = await res.json();
    const results = data.results ?? [];
    allProxies.push(...results);

    if (data.next) {
      totalPages = Math.ceil(data.count / 100);
      page++;
    } else {
      break;
    }
  }

  const valid = allProxies.filter((p) => p.valid !== false);
  if (valid.length === 0) {
    throw new Error("Webshare returned 0 valid proxies. Check your subscription.");
  }

  proxyListCache = valid;
  proxyListCacheAt = Date.now();
  return valid;
}

function generateSessionId() {
  return randomBytes(5).toString("hex").slice(0, 10);
}

function maskSecret(value, visible = 4) {
  if (!value || value.length <= visible) return "****";
  return `${value.slice(0, visible)}***`;
}

export function createProxySessionManager({
  country: _country,
  locationLabel,
  credentials,
} = {}) {
  loadProxyEnv();
  const rotations = [];
  let rotationCount = 0;
  let proxyList = [];

  return {
    async init() {
      proxyList = credentials
        ? [{ username: credentials.baseUser, password: credentials.password, proxy_address: null, port: null }]
        : await fetchProxyList();
    },

    rotateForSite(site) {
      rotationCount += 1;
      const idx = (rotationCount - 1) % (proxyList.length || 1);
      const proxy = proxyList[idx];
      const sessionId = generateSessionId();

      const proxyServer = proxy.proxy_address
        ? `http://${proxy.proxy_address}:${proxy.port}`
        : (process.env.WEBSHARE_PROXY_HOST
            ? `http://${process.env.WEBSHARE_PROXY_HOST}:${process.env.WEBSHARE_PROXY_PORT || "80"}`
            : null);

      const entry = {
        index: rotationCount,
        site,
        sessionId,
        username: proxy.username,
        password: proxy.password,
        proxyAddress: proxy.proxy_address ?? null,
        port: proxy.port ?? null,
        proxyServer,
        countryCode: proxy.country_code ?? null,
        cityName: proxy.city_name ?? null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        egressIp: null,
        egressCity: null,
        egressRegion: null,
        egressCountry: null,
        egressOrg: null,
        ipCheckOk: false,
        ipCheckError: null,
        ipCheckMs: null,
        scrapeJobs: 0,
        status: "active",
      };
      rotations.push(entry);
      return {
        username: proxy.username,
        password: proxy.password,
        proxyServer,
        entry,
      };
    },

    completeRotation(entry, { scrapeJobs, status, ipCheck } = {}) {
      if (!entry) return;
      entry.endedAt = new Date().toISOString();
      entry.scrapeJobs = scrapeJobs ?? entry.scrapeJobs ?? 0;
      entry.status = status ?? "ok";
      if (ipCheck) {
        entry.egressIp = ipCheck.ip ?? null;
        entry.egressCity = ipCheck.city ?? null;
        entry.egressRegion = ipCheck.region ?? null;
        entry.egressCountry = ipCheck.country ?? null;
        entry.egressOrg = ipCheck.org ?? null;
        entry.ipCheckOk = Boolean(ipCheck.ok);
        entry.ipCheckError = ipCheck.error ?? null;
        entry.ipCheckMs = ipCheck.ms ?? null;
      }
    },

    buildReport() {
      const uniqueIps = new Set(rotations.map((r) => r.egressIp).filter(Boolean));
      const ipChecks = rotations.filter((r) => r.ipCheckMs != null);
      const avgIpCheckMs = ipChecks.length
        ? Math.round(ipChecks.reduce((s, r) => s + r.ipCheckMs, 0) / ipChecks.length)
        : null;

      return {
        provider: DOCS.provider,
        mode: "proxy",
        configured: true,
        totalRotations: rotations.length,
        totalProxies: proxyList.length,
        rotations: rotations.map((r) => ({ ...r, password: r.password ? "***" : null })),
        summary: {
          rotationsUsed: rotations.length,
          uniqueEgressIps: uniqueIps.size,
          uniqueIps: [...uniqueIps],
          avgIpCheckMs,
          allIpChecksOk: rotations.every((r) => r.ipCheckOk || !r.ipCheckError),
          failedRotations: rotations.filter((r) => r.status === "error").length,
        },
      };
    },
  };
}

export async function checkProxyEgress(page) {
  const started = Date.now();
  try {
    const res = await page.goto("https://ipinfo.io/json", {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const data = JSON.parse(body);
    return {
      ok: res?.ok() !== false,
      ms: Date.now() - started,
      ip: data.ip ?? null,
      city: data.city ?? null,
      region: data.region ?? null,
      country: data.country ?? null,
      org: data.org ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err.message,
      ip: null,
      city: null,
      region: null,
      country: null,
      org: null,
    };
  }
}
