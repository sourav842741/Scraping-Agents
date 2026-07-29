# HR Finding Automation

Find companies on **LinkedIn**, discover **HR / Recruiter / Talent** contacts, and view results in a **Google Sheet-style** dashboard with clickable links and full history.

## Start

```bash
cd "HR Finding Automation"
npm install
npm start
```

Open **http://localhost:3940**

## Usage

1. Enter company or industry (e.g. `IndiGo`, `TCS`, `Razorpay`)
2. Set **companies to find** (1–20)
3. Set **HR people per company** (1–50)
4. Click **Find HR contacts** — headless browser runs Bing + LinkedIn discovery
5. View **Sheet view** (green header, clickable LinkedIn URLs), **Companies**, or **Activity log**
6. **Export CSV** — opens in Google Sheets / Excel

## Proxy (Webshare)

Optional Webshare proxy pool for scaling beyond local IP.

1. Set `WEBSHARE_API_KEY=...` in `.env`
2. Restart the server
3. Toggle **Proxy** in the dashboard header

The proxy manager initializes at startup, fetches available IPs from Webshare, and rotates through them per browser session. Status is visible via the `/api/proxy/status` endpoint.

## Storage

| Path | Contents |
|------|----------|
| `data/hr-finder.sqlite` | Jobs, companies, contacts, logs |
| `output/hr-sheet-{jobId}.csv` | Exported sheet per job |

## LinkedIn note

Public LinkedIn pages are often behind a login wall. This tool uses **Bing site: searches** to discover company and profile URLs, then scrapes what's publicly visible. For deeper results, LinkedIn login cookies can be added in a future update.
