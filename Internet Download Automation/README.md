# Internet Download Dashboard

Search the web and download images with **Puppeteer**, multi-platform search, **Webshare rotating proxy**, and a local dashboard.

## Quick start

```bash
cd "Internet Download Automation"
npm install
cp .env.example .env    # add WEBSHARE_API_KEY if using proxy
npm start
```

Open **http://localhost:3939**

## Proxy (Webshare)

1. Set `WEBSHARE_API_KEY=...` in `.env`
2. In the dashboard header, switch **Local** → **Proxy**

Each platform search gets a new sticky session = fresh egress IP from the Webshare pool.

Optional: `WEBSHARE_PROXY_COUNTRY` for geo-targeted IPs (paid plans only; free tier uses automatic assignment).

> **Note:** Webshare free tier provides 10 datacenter IPs. Some image platforms (Pinterest, Google Images) may still block datacenter ranges. For stricter targets, upgrade to a Webshare residential plan.

## Features

- **Auto** or manual platform pick: Bing, DuckDuckGo, Pinterest, Unsplash, Pixabay
- Browser-context downloads with retries
- Local IP or Webshare rotating proxy
- Live activity log + gallery + SQLite history

## API

- `GET /api/health` — includes proxy status
- `GET /api/proxy/status` — Webshare config snapshot
- `POST /api/jobs` — `{ query, count, autoMode, proxyMode, sources }`
- `GET /api/jobs/:id/stream` — SSE live log

## Storage

- `data/dashboard.sqlite` — jobs, logs, metadata
- `storage/downloads/{jobId}/` — image files
