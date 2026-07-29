# AI OS 3 — Scraping Agents

**By Sourav Kumar**

[![Repository](https://img.shields.io/badge/GitHub-AI--OS--3--scrapping--agents-blue)](https://github.com/vivekmishraishere/AI-OS-3-scrapping-agents)

A collection of browser-based data extraction tools with live dashboards — built for research, lead generation, and workflow automation. Each app runs independently with its own API, UI, and SQLite history.

> Public learning and productivity workspace. Use responsibly and in line with each platform's terms of service.

**Repository:** [github.com/vivekmishraishere/AI-OS-3-scrapping-agents](https://github.com/vivekmishraishere/AI-OS-3-scrapping-agents)

---

## What's inside

| Tool | Port | Stack | Best for |
|------|------|-------|----------|
| [**Job Extract OS**](./job-scraper-test/) | `3847` | Node · Puppeteer · React · Vite | Job market research across LinkedIn & Indeed |
| [**Google Search OS**](./google-search-scraper/) | `3848` | Node · Puppeteer · React · Vite | SERP extraction, lead lists, competitive research |
| [**Internet Download Dashboard**](./Internet%20Download%20Automation/) | `3939` | Node · Puppeteer · SQLite | Bulk image search & download from the open web |
| [**HR Finding Automation**](./HR%20Finding%20Automation/) | `3940` | Node · Puppeteer · SQLite | Company discovery → HR contact lists |
| [**Google Maps Scraper**](./google-maps-scraper/) | `3942` | Node · Puppeteer · SQLite | Local business leads from Maps search |

All proxy-enabled apps support **Webshare** datacenter proxy pool (optional, 10 IPs free tier). Works on local IP for light testing.

---

## Use cases

### For recruiters & HR teams
- **HR Finding Automation** — Search a company name (e.g. Razorpay, Infosys), discover matching companies, then pull HR / People-team contacts into an exportable sheet.
- **Job Extract OS** — Monitor open roles by keyword, location, experience, and work type across LinkedIn and Indeed; export structured job data for pipeline tracking.

### For sales, marketing & agencies
- **Google Search OS** — Build prospect lists from Google results (agencies, SaaS, local services) with domain, snippet, and remark columns; export to CSV.
- **Google Maps Scraper** — Extract business names, addresses, phones, ratings, and websites for a niche + location (e.g. "digital marketing agency in Mumbai").
- **Internet Download Dashboard** — Collect visual assets from Bing, DuckDuckGo, Pinterest, Unsplash, and Pixabay for mood boards, competitive audits, or content research.

### For developers & automation builders
- Reference implementations for **Puppeteer** scraping with headless Chrome, proxy sessions, job queues, SSE live logs, and SQLite persistence.
- Patterns for **guest (no-login) scraping**, rate-aware retries, and when to add datacenter proxies vs. split queries.
- Ready-to-deploy Node apps with `bean.conf` examples for [KloudBean](https://www.kloudbean.com/) or any VPS.
- **Webshare proxy** integrated in all projects — uses free-tier 10-IP pool via `WEBSHARE_API_KEY`.

### For educators & content creators
- Companion code for scraping strategy research — see [`SCRAPING-RESEARCH-NOTES.md`](./SCRAPING-RESEARCH-NOTES.md) for proxy decision frameworks, plateau vs. IP-block diagnostics, and responsible scaling guidance.

---

## Tool highlights

### Job Extract OS
Research-oriented job extraction with a React dashboard.

- LinkedIn & Indeed URL builder with filters (location, posted date, work type, experience)
- Live extraction stream with progress and screenshots
- Extraction history stored locally
- Optional Webshare proxy mode for geo-accurate, higher-volume runs

### Google Search OS
Google SERP scraper with a table dashboard, proxy support, and CSV export.

- Configurable query, location, and max results
- Result table with remarks, history, and full-view modal
- Proxy rotation per request via Webshare IP pool
- Built-in settings for download directory and run history

### Internet Download Dashboard
Search and download images from multiple platforms in one place.

- Multi-platform search: Bing, DuckDuckGo, Pinterest, Unsplash, Pixabay
- Snapshot, review, and batch-download workflows
- Per-job history and on-disk storage
- Optional proxy mode for blocked or geo-sensitive sources

### HR Finding Automation
Two-step workflow: find companies, then find HR contacts.

- **Step 1** — Company discovery from a brand-name query
- **Step 2** — Select companies and scrape HR / People profiles
- Live job logs via Server-Sent Events
- CSV export per run
- Optional LinkedIn session cookie (`LINKEDIN_LI_AT`) for deeper people search

### Google Maps Scraper
Google Maps business listing extraction with unlimited scroll.

- Query + location search with parallel job queue (up to 5 concurrent)
- Webshare proxy rotation on reject/soft-cap with configurable rotation limit
- SQLite history and CSV export
- Fast mode (list only) or Detail mode (visits each place for phone, website, email)
- Unlimited scroll mode — continues until feed ends, rotating IP on soft-cap

---

## Requirements

- **Node.js** 20+ (LTS recommended)
- **npm** 9+
- macOS, Linux, or Windows with enough RAM for headless Chrome (~2–4 GB free per active browser)
- **Webshare API key** (optional) — for proxy-enabled apps when scaling beyond local IP limits

---

## Environment variables

Each app ships with a `.env` file. Key variables:

| Variable | Apps | Purpose |
|----------|------|---------|
| `WEBSHARE_API_KEY` | All proxy-enabled apps | Webshare proxy pool (free: 10 datacenter IPs) |
| `LINKEDIN_LI_AT` | HR Finding | LinkedIn session cookie for deeper people search |
| `HEADLESS` | All | Set to `false` to see the browser window |
| `PORT` | All | Per-app default (3847–3942) |
| `HOST` | All | Defaults to `127.0.0.1` (use `0.0.0.0` for deployment) |
| `NODE_ENV` | All | Set to `production` for deployment |

---

## Quick start

```bash
# All projects use the same pattern:
cd <project-folder>
npm install
npm start
```

Each project's README has project-specific instructions.

---

## Project structure

```
AI-OS-3-scrapping-agents/
├── job-scraper-test/           # Job Extract OS
├── google-search-scraper/      # Google Search OS
├── Internet Download Automation/  # Image download dashboard
├── HR Finding Automation/      # Company + HR contact finder
├── google-maps-scraper/        # Google Maps business scraper
├── SCRAPING-RESEARCH-NOTES.md  # Proxy & scraping strategy notes
└── README.md                   # You are here
```

---

## Tech stack

- **Runtime:** Node.js (ES modules)
- **Server:** Express
- **Browser automation:** Puppeteer + puppeteer-extra-stealth
- **Dashboards:** Vanilla HTML/CSS or React + Vite
- **Storage:** SQLite (`node:sqlite` — Node 24+ built-in, no native builds)
- **Proxies:** Webshare API integration (optional, free tier: 10 datacenter IPs)

---

## Responsible use

These tools automate browser interactions with third-party websites. Before using them in production or at scale:

1. **Read each platform's Terms of Service** — LinkedIn, Indeed, Google, and others restrict automated access.
2. **Respect rate limits** — Start with low volume; add proxies only when you have evidence of IP-based blocking (not "empty results" plateaus).
3. **No credentials in git** — `.env` files are gitignored; rotate keys if they were ever exposed.
4. **Research & education first** — This repo is intended for learning, internal workflows, and building automation skills.

See [`SCRAPING-RESEARCH-NOTES.md`](./SCRAPING-RESEARCH-NOTES.md) for a deeper breakdown of when proxies help, when they don't, and how to scale without getting blocked.

---

## Author

**Sourav Kumar**

Builder of automation tools for scraping, lead research, and workflow productivity. This public repo documents real-world patterns for browser-based data extraction — from first prototype on a home IP to proxy-backed production deploys.

If you use this repo in a video, article, or course — a mention or link back is appreciated.

---

## License

This project is provided as-is for educational and research purposes. Third-party platforms, APIs, and data accessed through these tools remain subject to their own terms. Review and comply with applicable laws and platform policies in your jurisdiction before use.
