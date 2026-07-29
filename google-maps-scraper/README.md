# Google Maps Scraper

Google Maps business listing extraction with unlimited scroll, parallel job queue, Webshare proxy rotation, and an SQLite-backed dashboard.

## Quick start

```bash
cd google-maps-scraper
npm install
cp .env.example .env
npm start
```

Open **http://localhost:3942**

## Usage

1. Enter a **search query** (e.g. "digital marketing agency") and **location** (e.g. "Mumbai, India")
2. Set **Max results** (or leave at 0 for unlimited scroll)
3. Choose **Fast mode** (list only — name, rating, address) or **Detail mode** (visits each place's page for phone, website, email)
4. Click **Start scraping**
5. Results stream in live via SSE; export any job to CSV

## Features

- **Unlimited scroll** — continues until the feed ends, rotating proxy IP on Google soft-caps
- **Parallel jobs** — up to 5 concurrent scrapes with queue management
- **Fast / Detail modes** — list-only or full enrichment per place
- **Webshare proxy rotation** — rotates IP on reject/soft-cap, configurable rotation limit
- **SSE live logs** — real-time progress in the dashboard
- **SQLite history** — full job and result persistence
- **CSV export** — download per job for spreadsheet use

## Anti-detection

Uses **puppeteer-extra** + **puppeteer-extra-plugin-stealth** with randomized user-agent, viewport, and language. Each scrape warms up on google.com first. Maps renders heavily via JavaScript — the scraper waits for feed elements to appear before scrolling.

## Proxy (Webshare)

1. Set `WEBSHARE_API_KEY=...` in `.env`
2. Restart the server
3. Toggle **Proxy** in the dashboard header

The proxy manager fetches the Webshare IP list at startup, cycles IPs per session or on error (configurable rotation limit). Each scrape logs the egress IP and rotation count.

> **Note:** Webshare free datacenter IPs may be rate-limited by Google Maps. For sustained unlimited scroll, upgrade to Webshare residential proxies.

## API endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/proxy/status` | Proxy pool state |
| `GET /api/config` | App config |
| `GET /api/jobs` | Job history |
| `POST /api/jobs` | Create scrape job |
| `GET /api/jobs/:id/stream` | SSE live log |
| `GET /api/jobs/:id/results` | Job results |
| `GET /api/jobs/:id/export` | CSV download |
| `DELETE /api/jobs/:id` | Cancel / remove |
| `GET /api/jobs/active` | Active job count |

## Storage

- `data/maps-scraper.sqlite` — jobs, results, logs
- `output/` — CSV exports

## Requirements

- **Node.js** 20+ (uses built-in `node:sqlite`)
- **npm** 9+
- Windows, macOS, or Linux with Chrome/Chromium for Puppeteer
- **Webshare API key** (optional, for proxy mode)
