# Universal AI prompt: Webshare rotating proxy for Puppeteer

Give this file to anyone setting up proxy in a **Node.js + Puppeteer** scraper. It is **not tied to any specific app** — paste the block below into any AI assistant and describe your project at the end.

---

## Copy from here ↓

```
Implement Webshare rotating proxy in my Node.js + Puppeteer automation project.

## Context
- Runtime: Node.js (ES modules or CommonJS — match my project)
- Browser: Puppeteer (headless)
- Goal: route browser traffic through Webshare proxy pool with IP rotation and a way to test that it works before I run real scrapes

## Provider: Webshare
- Dashboard: https://proxy.webshare.io/
- API docs: https://proxy.webshare.io/api/v2/
- Free tier: 10 datacenter proxies (updated every ~30 days)
- Paid plans: residential proxies, more IPs, country targeting

## How Webshare works
- API key is used to fetch the proxy list: `GET /api/v2/proxy/list/`
- Each proxy in the list has: `proxy_address`, `port`, `username`, `password`
- All proxies share the same username/password (from your account)
- Rotation = pick a different proxy from the list OR request a different port
- Free tier: 10 fixed IPs. Rotate by cycling through them.

## .env (minimal — create .env.example too)
WEBSHARE_API_KEY=              # Dashboard → Copy API key

# Optional overrides
# WEBSHARE_PROXY_COUNTRY=us    # ISO country code — works on paid plans only
# WEBSHARE_PROXY_PROTOCOL=http # http (default) or socks5

## Rotation model
Two approaches:

### A. Proxy list rotation (recommended, free tier)
1. Fetch proxy list from `GET https://proxy.webshare.io/api/v2/proxy/list/` with `Authorization: Token {WEBSHARE_API_KEY}`
2. Parse response — each object has `proxy_address`, `port`, `username`, `password`
3. Pick a random proxy from the list for each new session
4. Log which IP was assigned

### B. Port-based rotation
1. Use `p.webshare.io:80` as the proxy host
2. Each proxy on your plan has a different port — cycle through them

## Puppeteer pattern
```js
// Pick a proxy from the list
const proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
const proxyServer = `http://${proxy.proxy_address}:${proxy.port}`;

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--proxy-server=${proxyServer}`
  ],
});
const page = await browser.newPage();
await page.authenticate({
  username: proxy.username,
  password: proxy.password
});
```

Important: if my app searches in Puppeteer but downloads with Node fetch(), fix that — downloads should use the same browser context (page.evaluate fetch or page.goto) so cookies/referer/egress match.

## Modules to add (adapt paths to my repo layout)
1. webshare-proxy.js
   - loadProxyEnv()
   - getApiKey(), isProxyConfigured()
   - fetchProxyList() → calls Webshare API, returns proxy array
   - pickProxy(proxyList) → random or round-robin selection
   - createProxySessionManager() with rotateForSession(label) returning { proxyServer, username, password }
   - completeRotation(entry, { ipCheck, status })
   - buildReport() → rotations used, unique egress IPs
   - checkProxyEgress(page) → { ok, ip, city, country }

2. browser.js (or integrate into existing launcher)
   - launchBrowser({ headless, proxyServer })
   - setupPage(page, { proxyAuth })

3. scripts/test-proxy.js
   - Load .env → fetch proxy list → one rotation → ipinfo check → print PASS/FAIL
   - Add npm script: "test:proxy": "node scripts/test-proxy.js"

## Integration requirements (adapt to my app type)
- Expose isProxyConfigured() at startup; log "proxy ready" or "local IP only"
- If I have a CLI: add --proxy flag
- If I have an API/dashboard: add proxyMode boolean on run requests; return 400 with setup hint if proxy requested but not configured
- If I have a UI: Local / Proxy toggle; disable Proxy when !isProxyConfigured()
- Log every rotation: index, egress IP, errors
- At end of run: summary of rotations and unique IPs

## Error handling
- Webshare API 401 → bad API key
- Empty proxy list → no proxies available on account
- ipinfo check fails → log warning, optionally continue or retry with new proxy
- HTTP 403 on target site via proxy → optional fallback to local IP (make this configurable)

## Common mistakes — avoid these
- Forgetting page.authenticate() after launch
- Using the API key as proxy username/password
- Proxy on Puppeteer only for search, fetch() for downloads on server IP
- Not rotating IP between sessions (using same proxy every time)
- Assuming datacenter proxies bypass all bot detection (they don't — see note below)

## Note on Webshare free tier
The free 10 datacenter IPs are useful for:
- Light testing and prototyping
- Spreading requests across multiple IPs
- Avoiding rate limits on lenient sites

They are often detected by strict platforms (Google, LinkedIn, social media). 
For production scraping on strict targets, upgrade to Webshare residential proxies.

## Deliverables
1. Working code integrated into MY project structure (inspect my repo first)
2. .env.example with only Webshare vars (no secrets)
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

## Copy until here ↑

---

## How to use

1. Copy the block above.
2. Paste into your AI assistant.
3. Fill in the **My project** section at the bottom (path, what you scrape, rotation preference).
4. Run `npm run test:proxy` (or equivalent) after the AI implements it.
5. Confirm egress IP in logs before running production scrapes.

## Quick human setup (no AI)

1. Sign up at [proxy.webshare.io](https://proxy.webshare.io/)
2. Dashboard → copy API key
3. `.env`: `WEBSHARE_API_KEY=your_key`
4. Optional: `WEBSHARE_PROXY_COUNTRY=us` for geo-targeted IPs (paid plans)

## Adapting for a different proxy provider

Same prompt structure works for other residential providers. Replace:

| Webshare | Generic equivalent |
|----------|-------------------|
| `proxy.webshare.io` API | provider's API endpoint |
| Proxy list fetch + random pick | provider's rotation/session syntax (read their docs) |
| `Authorization: Token {key}` | provider's auth mechanism |
| `page.authenticate()` | same for HTTP proxy auth in Puppeteer |

Keep the rotation principle: **pick a different proxy per logical unit of work**, verify egress IP, use one browser context for all requests.
