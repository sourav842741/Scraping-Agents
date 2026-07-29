# Universal AI Prompt: NodeMaven Rotating Proxy for Puppeteer

**By Vivek Mishra** · Part of the [Data Scraping Automation Suite](./README.md)

Give this file to anyone setting up proxy support in a **Node.js + Puppeteer** scraper. It is **not tied to any specific app** — copy the prompt block below, paste it into any AI assistant, and fill in your project details at the end.

---

## How to use

1. Copy the **prompt block** in the next section (from `Copy from here ↓` through `Copy until here ↑`).
2. Paste it into your AI assistant (Cursor, ChatGPT, Claude, etc.).
3. Fill in the **My project** section at the bottom of the prompt.
4. Let the AI inspect your repo and implement the integration.
5. Run `npm run test:proxy` (or equivalent) after implementation.
6. Confirm the **egress IP** in logs before running production scrapes.

---

## Quick human setup (no AI)

1. Sign up at [nodemaven.com](https://nodemaven.com/)
2. **Dashboard → Profile → API key** → copy your key
3. Add to `.env`:
   ```env
   NODEMAVEN_API_KEY=your_key
   ```
4. **Optional:** **Proxy Setup** → copy `proxy_username` / `proxy_password` if you want to skip the API lookup
5. **Optional:** `NODEMAVEN_PROXY_COUNTRY=us` for geo-targeted IPs (e.g. `in`, `gb`, `us`)

---

## AI prompt — copy everything below

> **Copy from here ↓**

```
Implement NodeMaven residential rotating proxy in my Node.js + Puppeteer automation project.

## Context

- Runtime: Node.js (ES modules or CommonJS — match my project)
- Browser: Puppeteer (headless)
- Goal: route browser traffic through NodeMaven with IP rotation, optional country targeting, and a way to test that it works before I run real scrapes

## Provider: NodeMaven (read official docs first)

- API access: https://docs.nodemaven.com/en/articles/10329935-api-access
- Swagger: https://dashboard.nodemaven.com/documentation/v2/swagger/
- Puppeteer integration: https://nodemaven.com/integrations/proxies-for-puppeteer/
- Getting started: https://docs.nodemaven.com/en/articles/9596871-getting-started-with-residential-and-mobile-proxies
- Username string format: https://docs.nodemaven.com/en/articles/12663937-how-to-manipulate-a-proxy-string

## Critical: two separate auth layers

Do NOT use the API key as the proxy password.

| Layer | Purpose | Auth |
|-------|---------|------|
| API key | REST API only (resolve account, locations, stats) | Header: `Authorization: x-api-key {NODEMAVEN_API_KEY}` |
| Proxy credentials | HTTP proxy tunnel to gate.nodemaven.com | `page.authenticate({ username, password })` in Puppeteer |

Flow:

1. If NODEMAVEN_PROXY_USER + NODEMAVEN_PROXY_PASSWORD are in .env → use them directly (from dashboard Proxy Setup).
2. Else if NODEMAVEN_API_KEY is set → call `GET https://api.nodemaven.com/api/v2/base/users/me` with `Authorization: x-api-key {key}` and read `proxy_username` + `proxy_password` from the JSON response.
3. Cache resolved credentials ~5 minutes.

## .env (minimal — create .env.example too)

NODEMAVEN_API_KEY=          # Dashboard → Profile → API key (recommended)

# Optional — skip API lookup if pasted from Proxy Setup
# NODEMAVEN_PROXY_USER=
# NODEMAVEN_PROXY_PASSWORD=

# Optional overrides (sensible defaults in code)
# NODEMAVEN_PROXY_HOST=gate.nodemaven.com
# NODEMAVEN_PROXY_PORT=8080
# NODEMAVEN_PROXY_PROTOCOL=http
# NODEMAVEN_PROXY_FILTER=medium    # low | medium | high
# NODEMAVEN_PROXY_COUNTRY=us       # ISO country code, e.g. us, in, gb

## Rotation model (how NodeMaven actually rotates)

Rotation = new sticky session id in the proxy USERNAME, not a different password.

Build username per session:

  {proxy_username}-country-{cc}-sid-{randomSessionId}-filter-{level}

- Append `-country-{cc}` only when NODEMAVEN_PROXY_COUNTRY is set
- Generate new `-sid-{8-10 char random}` for each rotation (new egress IP)
- Append `-filter-{low|medium|high}` (default medium)
- Do not duplicate modifiers if base username already contains them

When to rotate (pick what fits my app):

- Per target site (e.g. linkedin, indeed)
- Per search platform (e.g. google, bing)
- Per scrape job / batch
- Per N pages — document the choice

Each rotation cycle:

1. Build new username with fresh `-sid-`
2. Launch Puppeteer: args include `--proxy-server={protocol}://{host}:{port}`
3. `await page.authenticate({ username: builtUsername, password: proxy_password })`
4. Optional but recommended: verify egress via `page.goto('https://ipinfo.io/json')`, parse IP/city/country, log it
5. Run scrape/download in that browser session
6. Close browser; store rotation metadata (index, masked username, egress IP, duration, status)

## Puppeteer pattern (must use browser for all page loads AND in-page fetch)

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--proxy-server=http://gate.nodemaven.com:8080'],
});

const page = await browser.newPage();
await page.authenticate({ username: builtUsername, password: proxyPassword });

Important: if my app searches in Puppeteer but downloads with Node fetch(), fix that — downloads should use the same browser context (page.evaluate fetch or page.goto) so cookies/referer/egress match.

## Modules to add (adapt paths to my repo layout)

1. nodemaven-proxy.js (or src/lib/nodemaven-proxy.js)
   - loadProxyEnv()
   - getApiKey(), hasExplicitProxyCredentials(), isProxyConfigured()
   - resolveNodeMavenCredentials({ forceRefresh })
   - buildNodeMavenUsername({ baseUser, country, sessionId, filter })
   - createProxySessionManager() with rotateForSession(label) returning { username, password, proxyServer, entry }
   - completeRotation(entry, { ipCheck, status })
   - buildReport() → rotations used, unique egress IPs
   - checkProxyEgress(page) → { ok, ip, city, country, error }

2. browser.js (or integrate into existing launcher)
   - launchBrowser({ headless, proxyServer })
   - setupPage(page, { proxyAuth })

3. scripts/test-proxy.js
   - Load .env → resolve credentials → one rotation → ipinfo check → print PASS/FAIL
   - Add npm script: "test:proxy": "node scripts/test-proxy.js"

## Integration requirements (adapt to my app type)

- Expose isProxyConfigured() at startup; log "proxy ready" or "local IP only"
- If I have a CLI: add --proxy flag
- If I have an API/dashboard: add proxyMode boolean on run requests; return 400 with setup hint if proxy requested but not configured
- If I have a UI: Local / Proxy toggle; disable Proxy when !isProxyConfigured()
- Log every rotation: index, masked username, egress IP, errors
- At end of run: summary of rotations and unique IPs

## Error handling

- NodeMaven API 401 → bad API key
- Missing proxy_username in /users/me → use Proxy Setup credentials instead
- ipinfo check fails → log warning, optionally continue or retry with new `-sid-`
- HTTP 403 on target site via proxy → optional fallback to local IP (make this configurable)

## Common mistakes — avoid these

- Using API key as proxy password
- Static username without `-sid-` (no real rotation)
- Proxy on Puppeteer only for search, fetch() for downloads on server IP
- Forgetting page.authenticate() after launch
- Assuming PROXY_URL=http://user:pass@host works without NodeMaven username string modifiers

## Deliverables

1. Working code integrated into MY project structure (inspect my repo first)
2. .env.example with only NodeMaven vars (no secrets)
3. test-proxy script that proves egress IP changes
4. Short README section: how to get API key, test, enable proxy mode
5. Do not over-engineer — minimal diff, match my existing conventions

## My project (fill in when pasting)

- Project path:
- What it scrapes:
- Entry point (CLI / server / script):
- When proxy should rotate (per site / per job / other):
- Whether I need geo targeting (country code):
```

> **Copy until here ↑**

---

## Reference: auth layers at a glance

```mermaid
flowchart LR
  A[.env] --> B{Explicit proxy user/pass?}
  B -->|Yes| C[Use NODEMAVEN_PROXY_USER + PASSWORD]
  B -->|No| D[GET /api/v2/base/users/me]
  D --> E[proxy_username + proxy_password]
  C --> F[Build username with -sid-]
  E --> F
  F --> G[Puppeteer launch + page.authenticate]
  G --> H[ipinfo.io verify]
  H --> I[Scrape / download]
```

| Step | What happens |
|------|----------------|
| 1 | Load `.env` |
| 2 | Resolve proxy credentials (API or explicit) |
| 3 | Build username with fresh `-sid-{random}` |
| 4 | Launch Puppeteer with `--proxy-server` |
| 5 | `page.authenticate({ username, password })` |
| 6 | Verify egress IP (recommended) |
| 7 | Run scrape in same browser context |

---

## Adapting for a different proxy provider

The same prompt structure works for other residential providers. Replace:

| NodeMaven | Generic equivalent |
|-----------|-------------------|
| `gate.nodemaven.com:8080` | Provider's proxy `host:port` |
| Username modifiers (`-sid-`, `-country-`) | Provider's session/geo syntax (read their docs) |
| `GET /users/me` + API key | Provider's credential API or dashboard copy-paste |
| `page.authenticate()` | Same for HTTP proxy auth in Puppeteer |

**Keep the rotation principle:** new session identifier per logical unit of work, verify egress IP, and use **one browser context** for all requests (search + download).

---

## Already implemented in this repo

These projects in this workspace already follow this pattern:

| Project | Proxy module | Test script |
|---------|--------------|-------------|
| [google-search-scraper](./google-search-scraper/) | `src/nodemaven-proxy.js` | — |
| [google-maps-scraper](./google-maps-scraper/) | `src/nodemaven-proxy.js` | — |
| [job-scraper-test](./job-scraper-test/) | `src/nodemaven-proxy.js` | — |
| [Internet Download Automation](./Internet%20Download%20Automation/) | `server/nodemaven-proxy.js` | `npm run test:proxy` |

Use them as reference implementations when filling in the prompt, or when onboarding a new scraper into the suite.

---

## Related reading

- [SCRAPING-RESEARCH-NOTES.md](./SCRAPING-RESEARCH-NOTES.md) — when proxies help vs. guest-search plateaus
- [README.md](./README.md) — full suite overview and deployment notes
