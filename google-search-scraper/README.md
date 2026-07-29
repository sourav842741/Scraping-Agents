# Google Search OS

Google search extraction with a table dashboard, proxy support (Webshare), run history, remarks, and CSV export to your Desktop folder.

## Quick start

```bash
cd google-search-scraper
npm install
cp .env.example .env   # add WEBSHARE_API_KEY for proxy mode
npm run dev
```

Open **http://localhost:5174**

| Command | Purpose |
|---------|---------|
| `npm run dev` | API (`:3848`) + UI (`:5174`) |
| `npm run server` | API only |
| `npm run build:dashboard && npm start` | Production UI from API |

## Features

- **Google search** — paginates through results until the end (or max cap)
- **Table view** — title, domain, snippet, website ✓/✗, remarks, page
- **Full view** — expanded table with editable remarks per row (saved to history)
- **Proxy toggle** — Proxy is **default**; switch to Local system when testing
- **History** — every run saved to `output/history/`
- **CSV export** — downloads file and saves copy to your configured Desktop folder

## Anti-detection

This project uses **puppeteer-extra** with **puppeteer-extra-plugin-stealth** to evade Google's bot detection — plus random user-agent, viewport, and language fingerprinting per session. A warmup visit to google.com precedes each scrape to normalize the session before search.

Despite these measures, Google may still show CAPTCHA/empty results — especially from datacenter IPs. Webshare's free tier (10 datacenter IPs) is often detected; residential proxies improve success rates.

## Proxy (Webshare)

1. Set `WEBSHARE_API_KEY=...` in `.env`
2. Restart the server
3. **Proxy** mode is selected by default in the dashboard

Country targeting uses the **Location bias** field (e.g. India → `country-in`).

## Download folder

In the sidebar **Download** section, set the folder path (defaults to your Desktop) and click **Save folder**. CSV exports are written there and also trigger a browser download.

## Website ✓ / ✗

| Badge | Meaning |
|-------|---------|
| ✓ | Result links to a likely company website |
| ✗ | Directory, social, maps, or aggregator (LinkedIn, Yelp, etc.) |

## Warnings

- Google may show CAPTCHA on heavy or datacenter traffic — residential proxy helps
- Respect robots.txt and applicable laws for your use case
- Research / lead enrichment only — not for spam automation
