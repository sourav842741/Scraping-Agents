# Job scraper test (LinkedIn + Indeed)

**Research-only** Puppeteer extraction with a **Job Extract OS** dashboard — live progress (10/100…), visual job cards, LinkedIn/Indeed toggles.

## Job Extract OS (dashboard)

```bash
cd job-scraper-test
npm install
npm run dev
```

Open **http://localhost:5173** — configure **keywords**, **posted within** (1h–30d), **work type**, **sort**, quantity (**1–1000**), then **Extract**. URLs are built automatically (`f_TPR` / `fromage`). Puppeteer snapshots appear during runs.

| Command | Purpose |
|---------|---------|
| `npm run dev` | API (`:3847`) + UI (`:5173`) |
| `npm run server` | API only |
| `npm run build:dashboard && npm start` | Production UI served from API |

Set `HEADLESS=false` in env when running the server if you want a visible browser during extraction.

### Webshare proxy (optional)

Route Puppeteer through **Webshare** datacenter proxy pool (free tier: 10 IPs). The dashboard top bar has **Local system** / **Proxy** toggle (left of Research mode). Each site scrape gets a new sticky session; the **Proxy** panel lists rotations, egress IP, and a run summary.

1. Set `WEBSHARE_API_KEY=...` in `job-scraper-test/.env`
2. Restart `npm run server` or `npm run dev`
3. Toggle **Proxy** and run **Extract**

Country targeting is derived from your search **location** (e.g. India → `country-in`).

> **Note:** Webshare datacenter IPs are often detected by LinkedIn and Google as non-residential traffic. Residential or ISP proxies (paid plans) are needed for strict targets at scale.

## CLI tests (original)

```bash
npm test
```

## Warnings

- Do **not** put LinkedIn/Indeed credentials in this project.
- Prefer adding **direct job URLs** (`jobUrls`) copied from your browser over hammering search pages.
- Running logged-in automation on your personal account is **not** supported here (by design).
- Blocks, CAPTCHAs, and account/IP risk still apply; this only measures what happens.

## Setup

```bash
cd job-scraper-test
npm install
cp .env.example .env
```

## Configure URLs

Edit `test-urls.json`:

```json
{
  "linkedin": {
    "searchUrl": "https://www.linkedin.com/jobs/search?keywords=...",
    "jobUrls": ["https://www.linkedin.com/jobs/view/1234567890"]
  },
  "indeed": {
    "searchUrl": "https://www.indeed.com/jobs?q=...",
    "jobUrls": ["https://www.indeed.com/viewjob?jk=..."]
  }
}
```

To get a job URL: open a posting in Chrome → copy address bar.

## Run

```bash
# Both sites
npm test

# One site
npm run test:linkedin
npm run test:indeed

# Visible browser (see login walls / CAPTCHA)
HEADLESS=false npm test
```

Results are saved under `output/results-<timestamp>.json`.

## Reading results

| Field | Meaning |
|-------|---------|
| `ok: true` | Parsed at least one job (search) or job title (detail) and no block flags |
| `block.reasons` | e.g. `loginWall`, `captcha`, `rateLimit` |
| `jobs` | List from search page (may be empty if gated) |
| `job` | Single posting fields |
| `hint` | Loaded but nothing parsed |

## Expected outcomes (typical)

- **Indeed** search or `viewjob` URL: may work logged out for a while.
- **LinkedIn** search: often `loginWall` without session.
- **LinkedIn** job URL: sometimes partial data, often auth redirect.

Use outcomes to document research — not as proof that scale scraping is allowed.
