import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DOCS = {
  provider: "Webshare",
  website: "https://webshare.io/",
  apiDocs: "https://proxy.webshare.io/api/v2/",
  apiKeysPage: "https://proxy.webshare.io/",
};

let envLoaded = false;

export function loadProxyEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = join(ROOT, ".env");
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

export function isProxyConfigured() {
  return Boolean(getApiKey());
}

export function getProxyPublicConfig() {
  return {
    configured: isProxyConfigured(),
    provider: DOCS.provider,
    docs: DOCS,
    envHint: "Set WEBSHARE_API_KEY in .env (get from https://proxy.webshare.io/)",
  };
}

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

export function createProxySessionManager() {
  loadProxyEnv();
  const rotations = [];
  let rotationCount = 0;
  let proxyList = [];

  return {
    async init() {
      proxyList = await fetchProxyList();
    },

    rotateForPlatform(platformId) {
      rotationCount += 1;
      const idx = (rotationCount - 1) % proxyList.length;
      const proxy = proxyList[idx];
      const sessionId = generateSessionId();

      const proxyServer = `http://${proxy.proxy_address}:${proxy.port}`;
      const entry = {
        index: rotationCount,
        platform: platformId,
        sessionId,
        username: proxy.username,
        password: proxy.password,
        proxyAddress: proxy.proxy_address,
        port: proxy.port,
        proxyServer,
        countryCode: proxy.country_code ?? null,
        cityName: proxy.city_name ?? null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        egressIp: null,
        egressCity: null,
        egressCountry: null,
        ipCheckOk: false,
        ipCheckError: null,
        status: "active",
      };
      rotations.push(entry);
      return { username: proxy.username, password: proxy.password, proxyServer, entry };
    },

    completeRotation(entry, { status, ipCheck } = {}) {
      if (!entry) return;
      entry.endedAt = new Date().toISOString();
      entry.status = status ?? "ok";
      if (ipCheck) {
        entry.egressIp = ipCheck.ip ?? null;
        entry.egressCity = ipCheck.city ?? null;
        entry.egressCountry = ipCheck.country ?? null;
        entry.ipCheckOk = Boolean(ipCheck.ok);
        entry.ipCheckError = ipCheck.error ?? null;
      }
    },

    buildReport() {
      const uniqueIps = new Set(rotations.map((r) => r.egressIp).filter(Boolean));
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
