import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const DOCS = {
  provider: "NodeMaven",
  website: "https://nodemaven.com/",
  apiSwagger: "https://dashboard.nodemaven.com/documentation/v2/swagger/",
  puppeteerGuide: "https://nodemaven.com/integrations/proxies-for-puppeteer/",
  proxySetup:
    "https://docs.nodemaven.com/en/articles/9596871-getting-started-with-residential-and-mobile-proxies",
  proxyString:
    "https://docs.nodemaven.com/en/articles/12663937-how-to-manipulate-a-proxy-string",
  apiAccess: "https://docs.nodemaven.com/en/articles/10329935-api-access",
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

const API_BASE = "https://api.nodemaven.com";
let credentialsCache = null;
let credentialsCacheAt = 0;
const CREDENTIALS_TTL_MS = 5 * 60 * 1000;

export function parseTrafficFrozen(value) {
  if (value === true || value === "true" || value === "Yes" || value === "yes") {
    return true;
  }
  if (
    value === false ||
    value === "false" ||
    value === "No" ||
    value === "no" ||
    value == null
  ) {
    return false;
  }
  return Boolean(value);
}

export function getApiKey() {
  loadProxyEnv();
  return (
    process.env.NODEMAVEN_API_KEY?.trim() ||
    process.env.NODEMAVEN_APIKEY?.trim() ||
    null
  );
}

export function hasExplicitProxyCredentials() {
  loadProxyEnv();
  return Boolean(
    process.env.NODEMAVEN_PROXY_USER?.trim() &&
      process.env.NODEMAVEN_PROXY_PASSWORD?.trim()
  );
}

export function isProxyConfigured() {
  return Boolean(getApiKey() || hasExplicitProxyCredentials());
}

export async function resolveNodeMavenCredentials({ forceRefresh = false } = {}) {
  loadProxyEnv();

  if (hasExplicitProxyCredentials()) {
    return {
      baseUser: process.env.NODEMAVEN_PROXY_USER.trim(),
      password: process.env.NODEMAVEN_PROXY_PASSWORD.trim(),
      source: "env",
      account: null,
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "NodeMaven not configured: set NODEMAVEN_API_KEY in .env (Profile → API key) or NODEMAVEN_PROXY_USER + NODEMAVEN_PROXY_PASSWORD"
    );
  }

  if (
    !forceRefresh &&
    credentialsCache &&
    Date.now() - credentialsCacheAt < CREDENTIALS_TTL_MS
  ) {
    return credentialsCache;
  }

  const res = await fetch(`${API_BASE}/api/v2/base/users/me`, {
    headers: { Authorization: `x-api-key ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `NodeMaven API ${res.status}: ${body.slice(0, 200) || res.statusText}. Check API key (Profile → API key).`
    );
  }

  const data = await res.json();
  const baseUser = data.proxy_username?.trim();
  const password = data.proxy_password?.trim();

  if (!baseUser || !password) {
    throw new Error(
      "NodeMaven API did not return proxy_username/proxy_password. Copy credentials from Proxy Setup or contact support."
    );
  }

  credentialsCache = {
    baseUser,
    password,
    source: "api",
    account: {
      email: data.email ?? null,
      subscriptionStatus: data.subscription_status ?? null,
      trafficLimit: data.traffic_limit ?? null,
      trafficUsed: data.traffic_used ?? null,
      isTrafficFrozen: parseTrafficFrozen(data.is_traffic_frozen),
    },
  };
  credentialsCacheAt = Date.now();
  return credentialsCache;
}

export function getProxyPublicConfig() {
  loadProxyEnv();
  const apiKey = getApiKey();
  const explicit = hasExplicitProxyCredentials();
  return {
    configured: isProxyConfigured(),
    authMode: apiKey && !explicit ? "api_key" : explicit ? "proxy_credentials" : null,
    provider: DOCS.provider,
    host: process.env.NODEMAVEN_PROXY_HOST?.trim() || "gate.nodemaven.com",
    port: Number(process.env.NODEMAVEN_PROXY_PORT ?? 8080),
    protocol: process.env.NODEMAVEN_PROXY_PROTOCOL?.trim() || "http",
    filter: process.env.NODEMAVEN_PROXY_FILTER?.trim() || "medium",
    country: process.env.NODEMAVEN_PROXY_COUNTRY?.trim()?.toLowerCase() || null,
    rotatePerPlatform: process.env.NODEMAVEN_ROTATE_PER_PLATFORM !== "false",
    docs: DOCS,
    envHint:
      "Set NODEMAVEN_API_KEY only (recommended), or NODEMAVEN_PROXY_USER + NODEMAVEN_PROXY_PASSWORD from Proxy Setup",
  };
}

function generateSessionId() {
  return randomBytes(5).toString("hex").slice(0, 10);
}

function maskSecret(value, visible = 4) {
  if (!value || value.length <= visible) return "****";
  return `${value.slice(0, visible)}***`;
}

export function buildNodeMavenUsername({ baseUser, country, sessionId, filter = "medium" }) {
  let username = baseUser.trim();
  if (country && !username.includes("-country-")) {
    username += `-country-${country}`;
  }
  if (sessionId && !username.includes("-sid-")) {
    username += `-sid-${sessionId}`;
  }
  if (filter && !username.includes("-filter-")) {
    username += `-filter-${filter}`;
  }
  return username;
}

export function maskProxyUsername(username) {
  if (!username) return "—";
  return username
    .replace(/-sid-([a-z0-9]+)/i, (_, sid) => `-sid-${maskSecret(sid, 3)}`)
    .replace(/^([^-]{4})[^-]*/, "$1***");
}

export function createProxySessionManager({ credentials } = {}) {
  loadProxyEnv();
  const host = process.env.NODEMAVEN_PROXY_HOST?.trim() || "gate.nodemaven.com";
  const port = Number(process.env.NODEMAVEN_PROXY_PORT ?? 8080);
  const protocol = process.env.NODEMAVEN_PROXY_PROTOCOL?.trim() || "http";
  const filter = process.env.NODEMAVEN_PROXY_FILTER?.trim() || "medium";
  const baseUser =
    credentials?.baseUser ?? process.env.NODEMAVEN_PROXY_USER?.trim() ?? "";
  const password =
    credentials?.password ?? process.env.NODEMAVEN_PROXY_PASSWORD?.trim() ?? "";
  const credSource = credentials?.source ?? (hasExplicitProxyCredentials() ? "env" : "api");
  const account = credentials?.account ?? null;
  const country = process.env.NODEMAVEN_PROXY_COUNTRY?.trim()?.toLowerCase() || null;

  const rotations = [];
  let rotationCount = 0;
  const proxyServer = `${protocol}://${host}:${port}`;

  return {
    host,
    port,
    protocol,
    proxyServer,
    docs: DOCS,

    /** New sticky session per platform (fresh `-sid-` = new egress IP). */
    rotateForPlatform(platformId) {
      rotationCount += 1;
      const sessionId = generateSessionId();
      const username = buildNodeMavenUsername({
        baseUser,
        country,
        sessionId,
        filter,
      });
      const entry = {
        index: rotationCount,
        platform: platformId,
        sessionId,
        usernameMasked: maskProxyUsername(username),
        country: country ?? "any",
        host,
        port,
        protocol,
        filter,
        proxyServer: `${host}:${port}`,
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
      return { username, password, proxyServer, entry };
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
        credentialSource: credSource,
        accountEmail: account?.email ?? null,
        trafficUsed: account?.trafficUsed ?? null,
        trafficLimit: account?.trafficLimit ?? null,
        host,
        port,
        filter,
        country,
        totalRotations: rotations.length,
        rotations: rotations.map((r) => ({ ...r })),
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
