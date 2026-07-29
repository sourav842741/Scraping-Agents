# Web Scraping Research Notes

Research notes on proxy usage, ban risk, platform behavior, and implementation strategy for data-scraping automation projects. Compiled for planning video content and technical setup.

**Last updated:** June 4, 2026 (added §1.4–1.6: proxy decision example, plateau vs IP blocks, parallel scraping)

---

## Table of contents

1. [When you need proxies](#1-when-you-need-proxies)
   - [1.4 Example: parallel multi-location job scraping](#14-example-parallel-multi-location-job-scraping--do-you-need-proxies)
   - [1.5 What proxies cannot fix](#15-what-proxies-cannot-fix-guest-search-plateau)
   - [1.6 Parallel headless sessions](#16-parallel-headless-sessions-when-they-help)
2. [Three project angles — risk assessment](#2-three-project-angles--risk-assessment)
3. [IP bans vs account bans (personal system)](#3-ip-bans-vs-account-bans-personal-system)
4. [Scraping without login](#4-scraping-without-login)
5. [Recommended implementation order](#5-recommended-implementation-order)
6. [Simple “does it fail?” test plan](#6-simple-does-it-fail-test-plan)
7. [Video content framing](#7-video-content-framing)
8. [Decision checklists](#8-decision-checklists)
9. [Glossary & quick reference](#9-glossary--quick-reference)

---

## 1. When you need proxies

Proxies matter when **where the request appears to come from** is as important as **what you are scraping**.

### Scenarios that typically require proxies

| Scenario | Why proxies help | Typical signals |
|----------|------------------|-----------------|
| **Rate limits & IP-based blocking** | Sites cap requests per IP; rotation spreads load | Works for a few requests, then 403/429; works again after wait or different network |
| **Geo-restricted or geo-variant content** | Prices, catalogs, ads, legal text differ by region | Need data “as if” from US, EU, India, etc. |
| **Anti-bot at IP layer** | Datacenter IP reputation, ASN detection, velocity checks | CAPTCHA, challenge pages, empty HTML; home IP works but VPS does not |
| **Large-scale / continuous crawling** | One IP hitting thousands of URLs/hour triggers blocks | Blocks even with polite delays |
| **Many targets in parallel** | One IP scanning hundreds of domains looks like a botnet | WAF flags scanner-like patterns |
| **Login sessions & account limits** | Platforms limit per account **and** per IP | Multiple accounts from same IP get flagged together |
| **Isolating your real network** | Avoid flagging home/office IP used for banking, LinkedIn, etc. | Dedicated egress for crawler traffic |
| **Operational separation** | Controlled egress for logging, allowlists, billing | Policy/compliance, not only “bypass” |

### When proxies are often **not** needed (at first)

- Small volume with slow, respectful pacing
- Public APIs or official feeds (keys, documented quotas)
- Your own sites or staging environments
- Static files (sitemaps, public dumps)
- Managed platforms (e.g. Apify actors) that handle rotation

**Rule of thumb:** Add proxies when failures correlate with **your IP** (rate limit, geo block, datacenter detection), not when HTML structure, auth, or selectors are wrong.

### Proxy types (quick map)

| Type | Best for | Tradeoff |
|------|----------|----------|
| **Datacenter** | Cheap, high volume, less protected sites | Easier to detect |
| **Residential** | Strict targets, geo accuracy | Higher cost, slower; ToS sensitivity |
| **Mobile** | Very strict apps / social platforms | Expensive |
| **ISP / static residential** | Long-lived sessions (login, cart) | Middle ground; fewer rotations |

**Rotation:** *Rotate per request* vs *sticky session per login* — wrong choice breaks authenticated flows.

### Setup order (infrastructure)

1. **Prototype** — Single IP, delays, logging, error taxonomy (403 vs 429 vs CAPTCHA).
2. **Harden** — Retries, exponential backoff, caching, respect `robots.txt` where applicable.
3. **Add proxies** only for proven bottlenecks (e.g. US pricing → US residential; 10k pages/day → rotating pool).
4. **Integrate** — Env vars for proxy URL, per-site pools, metrics on block rate by proxy type.

### 1.4 Example: parallel multi-location job scraping — do you need proxies?

**Scenario (common in job-hunt automation demos):**

You run a Puppeteer scraper **without login** on LinkedIn and Indeed. Instead of one national search, you:

- Launch **several headless browsers in parallel** (e.g. 3–6 at once)
- Use **different locations** per session (Bengaluru, Mumbai, Delhi, Hyderabad, remote, etc.)
- Vary **keywords** or filters slightly per slice
- **Re-run** the same workflow on a schedule (daily refresh, “custom output” CSV/JSON each time)
- Merge and **dedupe** by job URL across runs

**Question for the audience:** *Do we need proxies for this?*

**Short answer:**

| Stage | Proxies needed? |
|-------|------------------|
| First test: 1–2 cities, **sequential**, slow delays, a few runs per day | **Usually no** — start on home IP |
| Growth: 3+ **parallel** sessions, many cities, repeated runs every hour | **Plan on yes** — residential/geo proxies become likely |
| Cloud VPS instead of home laptop | **Yes sooner** — datacenter IPs get challenged faster |
| Logged-in LinkedIn + heavy automation | Proxies **plus** very high **account** risk |

Proxies are **not** required to *start* learning or to prove the pipeline. They become important when **IP pressure** (volume × parallelism × frequency) exceeds what one home IP can carry without 429/CAPTCHA.

#### “IP pressure” mental model

Rough mental model for explaining to others:

```
IP pressure ≈ (parallel browsers) × (location/keyword slices) × (runs per day) × (pages scrolled per run)
```

- **Low pressure** → no proxy; use 2–5 s delays, cap parallel sessions at **2–3**, accept slower runs.
- **High pressure** → residential (or mobile for very strict targets) proxies; **sticky IP per browser for one full search**, rotate IP between slices — not a new IP on every click.

#### Walkthrough table (explain on a whiteboard)

| Setup | Parallel | Locations / runs | Typical outcome without proxy | When to add proxies |
|-------|----------|------------------|-------------------------------|---------------------|
| **A. Hobby test** | 1 browser | 1 city, 1 keyword, once | Often OK; ~25–100 jobs/site then plateau | Only if you already see CAPTCHA/429 |
| **B. Smart scale-up** | 2–3 | 6 cities sequential, polite delays | More **unique** jobs via dedupe; slower | If run #3 starts failing where run #1 worked |
| **C. Aggressive** | 5–10 | 10+ cities, hourly re-runs | Same IP hammering LinkedIn/Indeed | **Yes** — spread slices across IPs |
| **D. Cloud server** | Any | Any sustained crawl | Frequent empty HTML / blocks | **Yes** — prefer residential IN/US geo |

#### Real prototype result (why proxies weren’t the fix)

From the **Job Extract OS** guest scrape (`job-scraper-test/`, June 2026):

| Requested | Collected | Time | Block signals |
|-----------|-----------|------|---------------|
| 1000 jobs/site × LinkedIn + Indeed | **91 total** (60 LI + 31 Indeed) | ~61 s | No CAPTCHA; pages loaded |

The run stopped because **listings stopped appearing in the page** (guest search **plateau**), not because the home IP was banned. **Adding proxies to the same single search URL would not have produced ~2000 jobs** — five browsers on “Performance Marketer + India” would mostly return the same ~90 URLs.

Use this story when teaching: **proxies solve IP/geo/rate problems; query splitting solves coverage problems.**

#### What to do before buying proxies (same scenario)

1. **Split queries** — many small searches (city × keyword × date window), merge + dedupe.
2. **Fix geo** — e.g. use `in.indeed.com` and correct location params for India; avoid US leakage on `indeed.com?l=India`.
3. **Cap parallelism** — 2–3 headless sessions from home IP; sequential cities if blocks appear.
4. **Measure** — log 403, 429, CAPTCHA vs “0 new jobs after scroll” (plateau).
5. **Add proxies** only when metrics show **IP-correlated** failures while scaling B → C in the table above.

#### Proxy settings when you do add them (job boards)

| Setting | Recommendation |
|---------|----------------|
| **Type** | Residential or ISP for LinkedIn/Indeed; datacenter often blocked |
| **Geo** | Match job market (e.g. India residential for IN listings) |
| **Rotation** | Sticky for one full search session; rotate between city-slices |
| **Purpose** | Scale parallel location scrapes without burning home/office IP |

---

### 1.5 What proxies cannot fix (guest search plateau)

| Symptom | Likely cause | Will proxies help? |
|---------|--------------|-------------------|
| Scroll/pagination adds **no new job cards** | Guest index limit / plateau | **No** |
| **403 / 429** after N requests | Rate limit / IP reputation | **Yes** |
| **CAPTCHA** or “unusual activity” | Bot detection | **Sometimes** (with residential + slower pacing) |
| **Wrong country** jobs (e.g. US cities for India filter) | Geo / wrong domain | **Yes** (geo proxy + correct Indeed domain) |
| UI says “1000” but you get ~50–100 | Unrealistic target for guest scrape | **No** — change strategy (splits, API, Apify) |

**Teaching line:** *Proxies let you ask the site more times from more places; they don’t make one anonymous search expose 1000 listings.*

**Alternatives when volume is the goal:**

- Official/partner APIs (Indeed Publisher, licensed feeds)
- Managed Actors (Apify) with their own rotation
- Logged-in automation (high account risk — not recommended on personal LinkedIn)

---

### 1.6 Parallel headless sessions (when they help)

**Technically:** Puppeteer can run multiple `launch()` instances or one browser with multiple `createBrowserContext()` pages. `Promise.all` with a concurrency limit is standard.

| Parallel strategy | More unique jobs? | Faster? | Notes |
|-------------------|-------------------|---------|-------|
| Same search URL × N browsers | **No** (duplicates) | Marginal | Increases IP pressure; poor ROI |
| LinkedIn + Indeed at same time | Same totals per site | **Yes** | Good UX; doesn’t raise per-site ceiling |
| **Different** URL per session (city/keyword split) | **Yes** (after dedupe) | **Yes** | Right pattern; proxies help at scale |

**Resource rule of thumb:** ~150–400 MB RAM per headless Chrome on a Mac; 4+ parallel sessions → watch memory and thermals.

**Current project default (`job-scraper-test`):** one browser per site, **sequential** (LinkedIn then Indeed). Parallel sites or split-scrape modes are the next scaling step — pair with §1.4 when explaining infrastructure to others.

---

## 2. Three project angles — risk assessment

Planned content / product angles and their realistic risk profile.

### Summary matrix

| Idea | Ban / block risk | Account risk | Legal / ToS risk | Realistic without login? |
|------|------------------|--------------|------------------|---------------------------|
| **1. Automate job hunt (LinkedIn, Indeed)** | **High** | **Very high** (LinkedIn) | **High** | **Mostly no** for anything useful |
| **2. Scrape business website contact details** | **Low–medium** (per site) | Usually N/A | **Medium** (spam/privacy laws) | **Yes**, for many public sites |
| **3. “Download anything” with Puppeteer** | **Depends on target** | High if using user accounts | **High** if bypassing paywalls/DRM/login | **Sometimes** — only public, permitted URLs |

**Safest first technical experiment:** #2 (public contact pages, slow requests).  
**Highest risk on personal machine:** #1 with logged-in LinkedIn automation.

---

### 2.1 Automate job hunt (LinkedIn, Indeed)

**Can you get banned?** Yes. These platforms are built to stop automation.

**LinkedIn**

- **Account ban / restriction** is more common than permanent home IP ban.
- Detection signals: login patterns, headless browsers, request rate, repetitive actions, device fingerprint, IP reputation.
- Automation and scraping violate the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement).
- Unofficial APIs, browser bots, and bulk job scrapers are actively targeted.

**Indeed**

- Anti-bot: rate limits, blocks, CAPTCHAs.
- Some data on public job URLs; bulk search/list harvesting still triggers defenses.

**Without login — feasibility**

- **LinkedIn:** Very limited. Most listings, filters, Easy Apply, company insights, and search require login. Logged-out views are often truncated or blocked for bots. Not viable for “full job hunt automation” without login.
- **Indeed:** Individual **public job posting URLs** may yield title, company, location, snippet. **Search result pages** at scale → blocks quickly.

**Risks beyond IP**

- Account termination or restriction tied to **your real identity** when logged in.
- Legal/ToS exposure depending on jurisdiction and scale.

---

### 2.2 Scraping business website contact details

**Ban potential:** Usually **lower** than LinkedIn — many small sites, not one global anti-bot platform.

Per-site issues still possible:

- HTTP 403 / 429
- Cloudflare or similar WAF
- Temporary block on **that domain only** (rarely affects unrelated sites like LinkedIn unless same domain is hammered)

**Without login:** Yes — standard approach.

Common data locations:

- `/contact`, `/about`, footer
- `mailto:` and `tel:` links
- JSON-LD `Organization` schema
- Team / About pages

**Non-technical risks**

- **CAN-SPAM**, **GDPR**, and local privacy laws if storing emails for unsolicited outreach
- ToS on repackaging or reselling contact lists
- Data quality: `info@`, role accounts, outdated addresses

---

### 2.3 Download anything from the internet (Puppeteer, “no restriction”)

**Ban potential:** Entirely **target-dependent**.

| Target class | Risk level |
|--------------|------------|
| Static files, own sites, open datasets | Low |
| YouTube, streaming, paywalled news, social CDNs | High (ToS, technical blocks, legal) |
| Government, banking, healthcare | Very high — do not treat as generic download |

**What Puppeteer does and does not do**

- Renders what the browser session can access; does **not** bypass login walls, signed URLs, DRM, or bot detection by default.
- “Without restriction” in code ≠ permission from the site.

**Without login:** Only for **public, unauthenticated** resources.

---

## 3. IP bans vs account bans (personal system)

Running automation from a **personal PC** shares one egress IP with normal browsing (LinkedIn, banking, streaming).

### Typical restriction ladder

```
Few polite requests        → OK
Sustained high rate        → 429 / throttle
Obvious bot behavior       → CAPTCHA / challenge
Repeat abuse               → IP or account block (hours → weeks)
Severe / ToS violations    → Account terminated; IP may stay flagged longer
```

### Comparison table

| What gets restricted | Typical duration | Effect on daily use |
|----------------------|------------------|---------------------|
| **Rate limit / soft block** | Minutes to hours | Errors, CAPTCHA, slow responses |
| **IP challenge** | Hours to days | Verification required |
| **Account restriction** | Days to permanent | Cannot use platform normally; appeal may or may not work |
| **Hard IP block (home)** | Less common for light abuse; possible if aggressive | Same Wi‑Fi struggles with that site until IP changes or block clears |

### Key conclusions

- **IP bans are often temporary** (cooling-off period).
- **Account bans** (especially LinkedIn while logged in) are the main “I can’t use it normally anymore” risk.
- Automating **while logged in as yourself** ties bot behavior directly to your identity.
- **Unlikely:** “Forever banned from the internet” on a home IP from light testing.
- **Likely pain:** LinkedIn account flag + temporary IP challenges on the same network you use for real job search.

**Do not use Day-one experiments for:** LinkedIn logged-in automation, mass Indeed search, or unrestricted mass downloading.

---

## 4. Scraping without login

### How it works (technically)

1. HTTP client or headless browser requests a **public URL** (no session cookie / no auth header).
2. Server returns HTML (or JSON) available to anonymous visitors.
3. Parser extracts fields (CSS selectors, regex, JSON-LD, etc.).
4. Respect rate limits; log status codes per host.

**No login does not mean no rules:** `robots.txt`, ToS, rate limits, and laws still apply.

### Feasibility by use case

| Use case | Without login? | Notes |
|----------|----------------|-------|
| Business contact pages | **Yes** | Primary model for #2 |
| Single public job URL (known link) | **Partial** | Alert email → copy URL → fetch once |
| LinkedIn job search / feed | **No** (practically) | Needs authenticated session for useful data |
| Indeed search at scale | **No** (reliably) | Public posting URLs only, not full hunt |
| Arbitrary downloads | **Only if public** | Paywall/login = not “without login” |

### Implementation patterns (no login)

**A. Contact scraper (recommended first build)**

1. Input: company domains or homepage URLs.
2. `GET` homepage → discover links matching `contact`, `about`, etc.
3. `GET` contact page (1–2 requests per company, **2–5 s delay** between hosts).
4. Extract: email/phone regex, optional `schema.org` JSON-LD.
5. Output: CSV with domain, status code, emails found, errors.

Stack: `fetch` + HTML parser (e.g. Cheerio) first; Puppeteer only if content is JS-rendered and empty without browser.

**B. Minimal public job URL fetch**

1. Input: direct job URLs (from alerts, manual copy).
2. Fetch single page without session.
3. Parse title, company, location from HTML.
4. Do **not** automate platform search at scale without login.

**C. Puppeteer download (public only)**

1. One public file URL (e.g. PDF on company site).
2. Puppeteer: navigate, wait for load, save buffer or use network interception.
3. Compare with plain `curl` — if both work, browser may be unnecessary.

---

## 5. Recommended implementation order

| Phase | Focus | Proxies? |
|-------|--------|----------|
| **1. Prototype** | Contact scraper OR 3 public job URLs; logging, delays | No |
| **2. Measure failures** | Taxonomy: 200, 403, 429, timeout, CAPTCHA | No |
| **3. Harden** | Retries, backoff, caching, robots.txt awareness | No |
| **4. Scale / strict targets** | Add proxies only when IP-correlated blocks proven | Yes, targeted |

**Environment practices**

- Configurable delay between requests (env var).
- Per-host request counters and block rate metrics.
- Never commit credentials or proxy URLs to git (use `.env`).

---

## 6. Simple “does it fail?” test plan

**Goal:** Observe real HTTP behavior without risking LinkedIn account or home IP reputation.

### Day 1 (~30 minutes)

| Test | Action | Success metric | Failure signals |
|------|--------|----------------|-----------------|
| **Contact** | 10 business sites, contact/about pages | Emails/phones + status 200 | 403, 429, Cloudflare page, timeout |
| **Jobs (no login)** | 3 saved public job URLs (e.g. Indeed) | Parsed title, company | Block page, empty body, CAPTCHA |
| **Puppeteer** | 1 public PDF or file | File saved | 403, redirect to login, anti-bot |

### Explicitly avoid on Day 1

- LinkedIn login + automation
- Mass Indeed/LinkedIn search pagination
- “Any URL” downloader on major platforms (YouTube, social, paywalled media)

### What to log (for research)

- URL, timestamp, HTTP status, response time
- Whether CAPTCHA or challenge page detected
- Parser success (fields found vs empty)
- User-Agent and whether headless vs plain HTTP

---

## 7. Video content framing

Honest hooks vs technical reality for audience trust.

| Angle | Hook | Caveat to state clearly |
|-------|------|-------------------------|
| **Job automation** | “Can bots job-hunt while you sleep?” | LinkedIn/Indeed block automation; account risk; prefer alerts + official tools |
| **Contact scraping** | “Find emails from company websites” | Public pages only; spam/privacy laws; data quality varies |
| **Puppeteer downloader** | “Automate downloads from the web” | Only allowed public URLs; not paywall/DRM bypass |

---

## 8. Decision checklists

### Before buying or configuring proxies

1. **Volume** — Requests per minute/hour to the **same host**?
2. **Geography** — Must data match a specific country?
3. **Authentication** — Login required? (prefer sticky IPs, not random rotation per request)
4. **Rendering** — Is block IP-only or full browser fingerprint?
5. **Permission** — robots.txt, ToS, legal review for stored personal data (emails)
6. **Managed vs DIY** — Apify/other actors may include rotation; measure before building proxy pool
7. **Plateau vs block** — If parsers work but job count flatlines, fix query splitting first (see [§1.5](#15-what-proxies-cannot-fix-guest-search-plateau))
8. **Parallel locations** — If running many city slices in parallel repeatedly, see [§1.4](#14-example-parallel-multi-location-job-scraping--do-you-need-proxies)

### Before automating a platform (LinkedIn, Indeed, etc.)

1. Is there an **official API** or export?
2. Will you use **your personal account** on **your home IP**?
3. What is the **cost of account loss** vs benefit?
4. Can the same goal be met with **email alerts + single-URL fetch**?

### Before scraping contact data at scale

1. **Purpose** — Research vs cold outreach (legal differs)?
2. **Storage** — GDPR/right to erasure if EU contacts?
3. **Source** — Only publicly published on the company’s site?

---

## 9. Glossary & quick reference

| Term | Meaning |
|------|---------|
| **403 Forbidden** | Server refused access (often bot/WAF or permissions) |
| **429 Too Many Requests** | Rate limit; often temporary |
| **CAPTCHA / challenge** | Human verification; sign of bot detection |
| **Datacenter IP** | VPS/cloud IP; often lower trust score |
| **Residential IP** | Appears as home ISP; higher trust, higher cost |
| **Sticky session** | Same proxy IP for duration of login/cart flow |
| **Rotate per request** | New IP each request; bad for logged-in flows |
| **JSON-LD** | Structured data in `<script type="application/ld+json">` |
| **WAF** | Web Application Firewall (e.g. Cloudflare) |
| **Headless browser** | Puppeteer/Playwright without visible UI; detectable |
| **robots.txt** | Site-published crawl preferences (not law, but best practice) |

### One-line decisions

- **Need proxies?** → When blocks track your IP, not your parser.
- **Parallel many locations + re-run often?** → Start without; add residential/geo proxies when 429/CAPTCHA scale with volume (§1.4).
- **Got 91 jobs but asked for 1000?** → Plateau, not proxy problem — split searches and dedupe (§1.5).
- **Safest first scrape?** → Public business contact pages, slow rate.
- **Riskiest on personal PC?** → Logged-in LinkedIn automation.
- **Without login?** → Works for #2; not for full #1; limited for #3.

---

## Related next steps (project)

- [x] Job Extract OS prototype — guest LinkedIn/Indeed, dashboard, history (`job-scraper-test/`)
- [ ] Split-and-merge scrape mode (multiple locations/keywords, dedupe)
- [ ] Indeed India domain / geo hardening (`in.indeed.com`)
- [ ] Optional: parallel site scrape + capped parallel slices
- [ ] Scaffold minimal contact-scraper with CSV output and rate limiting
- [ ] Run Day 1 failure test and record metrics in spreadsheet
- [ ] Document per-site block patterns in append-only log
- [ ] Revisit proxy strategy only after IP-correlated failures are confirmed (use §1.4 checklist)
- [x] Job Extract OS — NodeMaven toggle + rotation report (`job-scraper-test/`, `.env.example`)

---

## References & links

- [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)
- Apify MCP / Actors (when using managed scraping): prefer store Actors for specific sites after reviewing README and input schema

---

*This document is for research and planning. It does not constitute legal advice. Review platform Terms of Service and applicable laws (privacy, anti-spam, computer misuse) before production scraping.*
