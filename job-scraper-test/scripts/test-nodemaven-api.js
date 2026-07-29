/**
 * Tests NodeMaven REST API per support: Authorization: x-api-key {api_key}
 * Does not print the API key.
 */
import { loadProxyEnv, getApiKey } from "../src/nodemaven-proxy.js";

loadProxyEnv();

const API_BASE = "https://api.nodemaven.com";

function maskKey(key) {
  if (!key || key.length < 8) return "(missing)";
  return `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;
}

async function apiGet(path, apiKey) {
  const url = `${API_BASE}${path}`;
  const started = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `x-api-key ${apiKey}` },
  });
  const ms = Date.now() - started;
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 300) };
  }
  return { url, status: res.status, ok: res.ok, ms, body };
}

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("FAIL: NODEMAVEN_API_KEY not set in .env");
    process.exit(1);
  }

  console.log("API key loaded:", maskKey(apiKey));
  console.log("Auth header format: x-api-key <key> (per NodeMaven support)\n");

  const required = [
    { name: "users/me", path: "/api/v2/base/users/me" },
    { name: "locations/countries", path: "/api/v2/base/locations/countries/" },
  ];
  const optional = [
    { name: "statistics/requests", path: "/api/v2/base/statistics/requests/" },
  ];

  let allOk = true;

  for (const ep of [...required, ...optional]) {
    const isOptional = optional.includes(ep);
    const r = await apiGet(ep.path, apiKey);
    const icon = r.ok ? "OK" : "FAIL";
    console.log(`[${icon}] ${ep.name}`);
    console.log(`      HTTP ${r.status} · ${r.ms}ms`);
    console.log(`      ${r.url}`);

    if (!r.ok) {
      if (isOptional) {
        console.log(`      (optional — ${r.body?.detail ?? "skipped"})`);
        console.log("");
        continue;
      }
      allOk = false;
      console.log(`      body:`, JSON.stringify(r.body).slice(0, 400));
      continue;
    }

    if (ep.name === "users/me") {
      const u = r.body;
      console.log(`      email: ${u.email ?? "—"}`);
      console.log(`      proxy_username: ${(u.proxy_username ?? "").slice(0, 16)}…`);
      console.log(`      has proxy_password: ${Boolean(u.proxy_password)}`);
      console.log(`      subscription_status: ${u.subscription_status ?? "—"}`);
      console.log(`      traffic_used: ${u.traffic_used ?? "—"}`);
      console.log(`      traffic_limit: ${u.traffic_limit ?? "—"}`);
      console.log(`      is_traffic_frozen: ${u.is_traffic_frozen ?? "—"}`);
    } else if (ep.name === "locations/countries") {
      const list = Array.isArray(r.body) ? r.body : r.body?.results ?? r.body?.data;
      const count = Array.isArray(list) ? list.length : typeof r.body === "object" ? Object.keys(r.body).length : "?";
      console.log(`      countries payload: ~${count} entries`);
    } else if (ep.name === "statistics/data") {
      console.log(`      keys: ${Object.keys(r.body ?? {}).join(", ") || "(object)"}`);
    }
    console.log("");
  }

  if (allOk) {
    console.log("PASS: API key is valid — all test endpoints returned 2xx.");
    console.log("Swagger: https://dashboard.nodemaven.com/documentation/v2/swagger/");
  } else {
    console.error("FAIL: One or more endpoints failed. Check API key at:");
    console.error("https://dashboard.nodemaven.com/user-profile?tab=API_KEY");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
