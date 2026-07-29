import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SearchableSelect from "./components/SearchableSelect.jsx";
import ProxyPanel from "./components/ProxyPanel.jsx";
import {
  POSTED_OPTIONS,
  WORK_OPTIONS,
  SORT_OPTIONS,
  LINKEDIN_EXP_OPTIONS,
  INDEED_EXP_OPTIONS,
  INDEED_JOB_TYPE_OPTIONS,
  buildFilterParams,
  fetchBuiltUrls,
} from "./lib/filters.js";

const MAX_JOBS = 1000;

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ChipGroup({ label, options, value, onChange, disabled }) {
  return (
    <div className="chip-group">
      <span className="chip-label">{label}</span>
      <div className="chips">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`chip ${value === opt.id ? "active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [linkedinOn, setLinkedinOn] = useState(true);
  const [indeedOn, setIndeedOn] = useState(true);
  const [keywords, setKeywords] = useState("software engineer");
  const [location, setLocation] = useState("United States");
  const [separateLocations, setSeparateLocations] = useState(false);
  const [linkedinLocation, setLinkedinLocation] = useState("United States");
  const [indeedLocation, setIndeedLocation] = useState("Remote");
  const [postedWithin, setPostedWithin] = useState("24h");
  const [customHours, setCustomHours] = useState(24);
  const [sort, setSort] = useState("date");
  const [linkedinWorkType, setLinkedinWorkType] = useState("any");
  const [indeedWorkType, setIndeedWorkType] = useState("remote");
  const [linkedinExperience, setLinkedinExperience] = useState("any");
  const [indeedExperience, setIndeedExperience] = useState("entry");
  const [indeedJobType, setIndeedJobType] = useState("any");
  const [quantity, setQuantity] = useState(50);
  const [headless, setHeadless] = useState(true);
  const [useCustomUrls, setUseCustomUrls] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [indeedUrl, setIndeedUrl] = useState("");
  const [builtUrls, setBuiltUrls] = useState({ linkedin: "", indeed: "" });
  const [viewMode, setViewMode] = useState("cards");
  const [jobFilter, setJobFilter] = useState("");

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Configure search and extract");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeSite, setActiveSite] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [screenshots, setScreenshots] = useState({});
  const [historyRuns, setHistoryRuns] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [viewSource, setViewSource] = useState("live");
  const [serverBusy, setServerBusy] = useState(false);
  const [runSummary, setRunSummary] = useState(null);
  const [egressMode, setEgressMode] = useState("local");
  const [proxyConfigured, setProxyConfigured] = useState(false);
  const [proxyReport, setProxyReport] = useState(null);

  const eventSourceRef = useRef(null);
  const streamDoneRef = useRef(false);
  const extractLockRef = useRef(false);

  const pushLog = useCallback((text, level = "info") => {
    setLogs((prev) => [{ t: formatTime(), text, level }, ...prev.slice(0, 99)]);
  }, []);

  const selectedSites = useMemo(() => {
    const s = [];
    if (linkedinOn) s.push("linkedin");
    if (indeedOn) s.push("indeed");
    return s;
  }, [linkedinOn, indeedOn]);

  const targetTotal = quantity * selectedSites.length;
  const progressPct =
    targetTotal > 0 ? Math.min(100, (current / targetTotal) * 100) : 0;

  const linkedinCount = jobs.filter((j) => j.site === "linkedin").length;
  const indeedCount = jobs.filter((j) => j.site === "indeed").length;

  const filteredJobs = useMemo(() => {
    const q = jobFilter.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.title?.toLowerCase().includes(q) ||
        j.company?.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q)
    );
  }, [jobs, jobFilter]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.defaults) {
          const d = cfg.defaults;
          setKeywords(d.keywords ?? keywords);
          setLocation(d.location ?? location);
          setSeparateLocations(d.separateLocations ?? false);
          setLinkedinLocation(d.linkedinLocation ?? linkedinLocation);
          setIndeedLocation(d.indeedLocation ?? indeedLocation);
          setPostedWithin(d.postedWithin ?? postedWithin);
          setCustomHours(d.customHours ?? customHours);
          setSort(d.sort ?? sort);
          setLinkedinWorkType(d.linkedinWorkType ?? linkedinWorkType);
          setIndeedWorkType(d.indeedWorkType ?? indeedWorkType);
          setLinkedinExperience(d.linkedinExperience ?? linkedinExperience);
          setIndeedExperience(d.indeedExperience ?? indeedExperience);
          setIndeedJobType(d.indeedJobType ?? indeedJobType);
          setQuantity(d.quantity ?? quantity);
        }
        if (cfg.built) setBuiltUrls(cfg.built);
        if (cfg.proxy) {
          setProxyConfigured(Boolean(cfg.proxy.configured));
        }
      })
      .catch(() => {});
  }, []);

  const filterState = useMemo(
    () => ({
      keywords,
      location,
      separateLocations,
      linkedinLocation: separateLocations ? linkedinLocation : location,
      indeedLocation: separateLocations ? indeedLocation : location,
      postedWithin,
      customHours,
      sort,
      linkedinWorkType,
      indeedWorkType,
      linkedinExperience,
      indeedExperience,
      indeedJobType,
    }),
    [
      keywords,
      location,
      separateLocations,
      linkedinLocation,
      indeedLocation,
      postedWithin,
      customHours,
      sort,
      linkedinWorkType,
      indeedWorkType,
      linkedinExperience,
      indeedExperience,
      indeedJobType,
    ]
  );

  useEffect(() => {
    if (useCustomUrls) return;
    const t = setTimeout(() => {
      fetchBuiltUrls(buildFilterParams(filterState))
        .then((urls) => {
          setBuiltUrls(urls);
          setLinkedinUrl(urls.linkedin);
          setIndeedUrl(urls.indeed);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [filterState, useCustomUrls]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      setHistoryRuns(data.runs ?? []);
    } catch {
      pushLog("Could not load extraction history", "warn");
    }
  }, [pushLog]);

  useEffect(() => {
    loadHistory();
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => setServerBusy(Boolean(s.running)))
      .catch(() => {});
  }, [loadHistory]);

  const loadHistoryRun = useCallback(
    async (id) => {
      try {
        const res = await fetch(`/api/history/${id}`);
        if (!res.ok) throw new Error("Not found");
        const run = await res.json();
        setSelectedHistoryId(id);
        setViewSource("history");
        setJobs(run.jobs ?? []);
        setCurrent(run.totalCollected ?? run.jobs?.length ?? 0);
        setTotal((run.quantity ?? 0) * (run.sites?.length ?? 1));
        setStatus("done");
        setRunSummary(run.summary ?? null);
        setEgressMode(run.proxyMode ? "proxy" : "local");
        setProxyReport(run.proxyReport ?? null);
        setLogs(
          (run.activityLog ?? []).map((l) => ({
            t: l.t
              ? new Date(l.t).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "—",
            text: l.text,
            level: l.level ?? "info",
          }))
        );
        setMessage(
          run.summary?.title ??
            `History · ${run.totalCollected ?? 0} jobs · ${run.status}`
        );
        pushLog(`Loaded history: ${id} (${run.totalCollected ?? 0} jobs)`, "info");
      } catch {
        pushLog(`Failed to load run ${id}`, "error");
      }
    },
    [pushLog]
  );

  const resetServer = useCallback(async () => {
    await fetch("/api/extract/reset", { method: "POST" });
    setServerBusy(false);
    setRunning(false);
    setStatus("idle");
    pushLog("Server run lock cleared", "warn");
  }, [pushLog]);

  const cancel = useCallback(() => {
    fetch("/api/extract/cancel", { method: "POST" }).catch(() => {});
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setRunning(false);
    setStatus("idle");
    setMessage("Cancelled");
    pushLog("Extraction cancelled", "warn");
  }, [pushLog]);

  const startExtract = useCallback(async () => {
    if (extractLockRef.current) {
      pushLog("Extract already starting…", "warn");
      return;
    }
    if (selectedSites.length === 0) {
      pushLog("Select at least one platform", "warn");
      return;
    }

    const liUrl = useCustomUrls ? linkedinUrl.trim() : builtUrls.linkedin;
    const inUrl = useCustomUrls ? indeedUrl.trim() : builtUrls.indeed;

    if (linkedinOn && !liUrl) {
      pushLog("LinkedIn URL missing", "warn");
      return;
    }
    if (indeedOn && !inUrl) {
      pushLog("Indeed URL missing", "warn");
      return;
    }

    const statusRes = await fetch("/api/status").catch(() => null);
    if (statusRes?.ok) {
      const st = await statusRes.json();
      if (st.running) {
        setServerBusy(true);
        pushLog(
          `Server busy (run ${st.runId ?? "?"}). Wait or click Reset lock.`,
          "error"
        );
        return;
      }
    }

    extractLockRef.current = true;
    streamDoneRef.current = false;
    eventSourceRef.current?.close();

    setViewSource("live");
    setSelectedHistoryId(null);
    setRunSummary(null);
    setProxyReport(egressMode === "proxy" ? { mode: "proxy", totalRotations: 0, rotations: [], summary: null } : null);
    setLogs([]);
    setJobs([]);
    setScreenshots({});
    setCurrent(0);
    setTotal(targetTotal);
    setRunning(true);
    setServerBusy(true);
    setStatus("running");
    setMessage("Connecting to scraper…");
    setActiveSite(null);
    if (egressMode === "proxy" && !proxyConfigured) {
      pushLog("Proxy mode: add WEBSHARE_API_KEY to .env and restart API", "error");
      extractLockRef.current = false;
      return;
    }

    pushLog(
      `Extract ${selectedSites.join(" + ")} · ${quantity} jobs each · ${postedWithin} · ${egressMode === "proxy" ? "Webshare proxy" : "local IP"}`,
      "success"
    );

    const params = new URLSearchParams({
      sites: selectedSites.join(","),
      quantity: String(quantity),
      headless: headless ? "true" : "false",
      proxyMode: egressMode === "proxy" ? "true" : "false",
      ...buildFilterParams(filterState),
      useCustomUrls: useCustomUrls ? "true" : "false",
      linkedinUrl: liUrl,
      indeedUrl: inUrl,
    });

    const es = new EventSource(`/api/extract/stream?${params}`);
    eventSourceRef.current = es;

    const finishStream = (finalStatus, msg) => {
      if (streamDoneRef.current) return;
      streamDoneRef.current = true;
      setRunning(false);
      setServerBusy(false);
      setStatus(finalStatus);
      setMessage(msg);
      extractLockRef.current = false;
      es.close();
      eventSourceRef.current = null;
      loadHistory();
    };

    es.addEventListener("open", () => {
      pushLog("Connected — live stream active", "success");
    });

    es.addEventListener("log", (e) => {
      const d = JSON.parse(e.data);
      const t = d.t
        ? new Date(d.t).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : formatTime();
      setLogs((prev) => [{ t, text: d.text, level: d.level ?? "info" }, ...prev.slice(0, 199)]);
    });

    es.addEventListener("ping", () => {
      setServerBusy(true);
      setRunning(true);
    });

    es.addEventListener("run-start", (e) => {
      const d = JSON.parse(e.data);
      setTotal(d.quantity * d.sites.length);
      setRunning(true);
      setMessage("Extraction running…");
      if (d.proxyReport) setProxyReport(d.proxyReport);
      pushLog(`Run ${d.runId} · ${d.quantity} jobs per site`, "info");
    });

    es.addEventListener("proxy-report", (e) => {
      const d = JSON.parse(e.data);
      if (d.proxyReport) setProxyReport(d.proxyReport);
    });

    es.addEventListener("proxy-summary", (e) => {
      const d = JSON.parse(e.data);
      if (d.proxyReport) setProxyReport(d.proxyReport);
    });

    es.addEventListener("proxy-rotation", () => {});
    es.addEventListener("proxy-ip", () => {});
    es.addEventListener("proxy-rotation-complete", () => {});

    es.addEventListener("screenshot", (e) => {
      const d = JSON.parse(e.data);
      setScreenshots((prev) => ({ ...prev, [d.site]: d.path }));
    });

    es.addEventListener("site-start", (e) => {
      const d = JSON.parse(e.data);
      setActiveSite(d.site);
      setMessage(`Extracting ${d.site}…`);
    });

    es.addEventListener("status", (e) => {
      const d = JSON.parse(e.data);
      setMessage(d.message);
    });

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data);
      const siteIndex = selectedSites.indexOf(d.site);
      setCurrent(siteIndex * quantity + d.current);
      const target = d.total ?? d.quantity ?? quantity;
      setMessage(`${d.site} · ${d.current} / ${target}`);
      setJobs((prev) => {
        if (prev.some((j) => j.url === d.job.url && j.site === d.job.site))
          return prev;
        return [d.job, ...prev];
      });
    });

    es.addEventListener("plateau", (e) => {
      const d = JSON.parse(e.data);
      setMessage(d.message ?? `Plateau at ${d.collected}/${d.target}`);
    });

    es.addEventListener("block", (e) => {
      const d = JSON.parse(e.data);
      setMessage(`Blocked: ${d.reasons?.join(", ")}`);
    });

    es.addEventListener("error", (e) => {
      try {
        const d = JSON.parse(e.data);
        pushLog(d.message ?? "Error", "error");
        setMessage(d.message ?? "Error");
      } catch {
        /* SSE transport error handled in onerror */
      }
    });

    es.addEventListener("site-complete", (e) => {
      const d = JSON.parse(e.data);
      setMessage(`${d.site}: ${d.count} jobs collected`);
    });

    es.addEventListener("history-saved", (e) => {
      const d = JSON.parse(e.data);
      pushLog(`Saved to output/history/${d.runId}.json`, "success");
      loadHistory();
    });

    es.addEventListener("run-complete", (e) => {
      const d = JSON.parse(e.data);
      setCurrent(d.totalCollected);
      setRunSummary(d.summary ?? null);
      if (d.proxyReport) setProxyReport(d.proxyReport);
      const outcome = d.summary?.outcome ?? d.status;
      pushLog(
        `${d.summary?.title ?? "Complete"}: ${d.totalCollected} jobs (${d.status})`,
        outcome === "success" ? "success" : "warn"
      );
      finishStream(
        outcome === "failed" ? "idle" : "done",
        d.summary?.title ?? `Done — ${d.totalCollected} jobs`
      );
    });

    es.onerror = async () => {
      if (streamDoneRef.current) return;

      if (es.readyState === EventSource.CONNECTING) {
        pushLog("Stream failed to connect (409 busy or server down?)", "error");
        finishStream("idle", "Connection failed");
        return;
      }

      if (es.readyState === EventSource.CLOSED) {
        const st = await fetch("/api/status")
          .then((r) => r.json())
          .catch(() => ({ running: false }));

        if (st.running) {
          pushLog(
            "Browser disconnected UI — scrape may still run on server. Wait or Reset.",
            "warn"
          );
          setRunning(true);
          setServerBusy(true);
          setMessage("Server still running…");
        } else if (!streamDoneRef.current) {
          pushLog("Stream closed before completion", "warn");
          finishStream("idle", "Stream ended");
        }
      }
    };
  }, [
    selectedSites,
    linkedinOn,
    indeedOn,
    linkedinUrl,
    indeedUrl,
    builtUrls,
    useCustomUrls,
    quantity,
    headless,
    filterState,
    targetTotal,
    pushLog,
    loadHistory,
    postedWithin,
    egressMode,
    proxyConfigured,
  ]);

  return (
    <div className={`shell status-${status}`}>
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="9" fill="url(#lg)" />
              <path
                d="M9 22V10h4.2l3.1 8.2L19.4 10H23v12h-3.4v-7.5L16.2 22h-2.8l-3.4-7.5V22H9z"
                fill="#0b0f1a"
              />
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
                  <stop stopColor="#38bdf8" />
                  <stop offset="1" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <h1>Job Extract OS</h1>
            <p>Live scraper · filters · up to {MAX_JOBS} jobs</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div
            className="egress-toggle"
            role="group"
            aria-label="Egress: local system or proxy"
          >
            <button
              type="button"
              className={egressMode === "local" ? "active" : ""}
              disabled={running || serverBusy}
              onClick={() => setEgressMode("local")}
            >
              Local system
            </button>
            <button
              type="button"
              className={egressMode === "proxy" ? "active" : ""}
              disabled={running || serverBusy}
              title={
                proxyConfigured
                  ? "Route Puppeteer via Webshare"
                  : "Set WEBSHARE_API_KEY in .env"
              }
              onClick={() => setEgressMode("proxy")}
            >
              Proxy
            </button>
          </div>
          <span className="pill warn">Research mode</span>
          <span
            className={`pill ${running || serverBusy || status === "running" ? "live" : ""}`}
          >
            {running || serverBusy || status === "running"
              ? "● Live"
              : viewSource === "history"
                ? "History"
                : "Idle"}
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section className="card">
            <h2>Platforms</h2>
            <div className="platform-grid">
              <label className={`platform ${linkedinOn ? "on linkedin" : ""}`}>
                <input
                  type="checkbox"
                  checked={linkedinOn}
                  disabled={running}
                  onChange={(e) => setLinkedinOn(e.target.checked)}
                />
                <span className="platform-name">LinkedIn</span>
                <span className="platform-sub">f_TPR · f_WT · sortBy</span>
              </label>
              <label className={`platform ${indeedOn ? "on indeed" : ""}`}>
                <input
                  type="checkbox"
                  checked={indeedOn}
                  disabled={running}
                  onChange={(e) => setIndeedOn(e.target.checked)}
                />
                <span className="platform-name">Indeed</span>
                <span className="platform-sub">fromage · sort · sc</span>
              </label>
            </div>
          </section>

          <section className="card section-common">
            <h2>Common filters</h2>
            <p className="section-desc">Shared across LinkedIn and Indeed</p>
            <div className="field">
              <label>Keywords</label>
              <input
                value={keywords}
                disabled={running || useCustomUrls}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="e.g. software engineer, react developer"
              />
            </div>

            {!separateLocations && (
              <SearchableSelect
                label="Location"
                value={location}
                disabled={running || useCustomUrls}
                placeholder="Search city, country, or Remote…"
                onChange={setLocation}
              />
            )}

            <label className="check-row">
              <input
                type="checkbox"
                checked={separateLocations}
                disabled={running || useCustomUrls}
                onChange={(e) => setSeparateLocations(e.target.checked)}
              />
              Separate location per platform
            </label>

            <ChipGroup
              label="Posted within"
              options={POSTED_OPTIONS}
              value={postedWithin}
              disabled={running || useCustomUrls}
              onChange={setPostedWithin}
            />
            {postedWithin === "custom" && (
              <div className="field custom-hours">
                <label>Custom hours</label>
                <div className="custom-hours-row">
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={customHours}
                    disabled={running || useCustomUrls}
                    onChange={(e) =>
                      setCustomHours(
                        Math.min(720, Math.max(1, Number(e.target.value) || 1))
                      )
                    }
                  />
                  <span className="unit">hours</span>
                </div>
                <p className="filter-hint">
                  LinkedIn uses exact seconds (<code>f_TPR=r{customHours * 3600}</code>
                  ). Indeed rounds up to day buckets (<code>fromage</code>).
                </p>
              </div>
            )}

            <ChipGroup
              label="Sort order"
              options={SORT_OPTIONS}
              value={sort}
              disabled={running || useCustomUrls}
              onChange={setSort}
            />
          </section>

          {linkedinOn && (
            <section className="card section-linkedin">
              <h2>
                <span className="dot li" /> LinkedIn filters
              </h2>
              {separateLocations && (
                <SearchableSelect
                  label="Location"
                  value={linkedinLocation}
                  disabled={running || useCustomUrls}
                  onChange={setLinkedinLocation}
                />
              )}
              <ChipGroup
                label="Work type"
                options={WORK_OPTIONS}
                value={linkedinWorkType}
                disabled={running || useCustomUrls}
                onChange={setLinkedinWorkType}
              />
              <ChipGroup
                label="Experience"
                options={LINKEDIN_EXP_OPTIONS}
                value={linkedinExperience}
                disabled={running || useCustomUrls}
                onChange={setLinkedinExperience}
              />
              <p className="filter-hint">
                Maps to <code>f_WT</code>, <code>f_E</code> (Fresher = Entry).
              </p>
            </section>
          )}

          {indeedOn && (
            <section className="card section-indeed">
              <h2>
                <span className="dot in" /> Indeed filters
              </h2>
              {separateLocations && (
                <SearchableSelect
                  label="Location"
                  value={indeedLocation}
                  disabled={running || useCustomUrls}
                  onChange={setIndeedLocation}
                />
              )}
              <ChipGroup
                label="Work type"
                options={WORK_OPTIONS}
                value={indeedWorkType}
                disabled={running || useCustomUrls}
                onChange={setIndeedWorkType}
              />
              <ChipGroup
                label="Experience"
                options={INDEED_EXP_OPTIONS}
                value={indeedExperience}
                disabled={running || useCustomUrls}
                onChange={setIndeedExperience}
              />
              <ChipGroup
                label="Job type"
                options={INDEED_JOB_TYPE_OPTIONS}
                value={indeedJobType}
                disabled={running || useCustomUrls}
                onChange={setIndeedJobType}
              />
              <p className="filter-hint">
                Maps to <code>explvl</code>, <code>jt</code>, remote <code>sc</code>.
              </p>
            </section>
          )}

          <section className="card">
            <label className="check-row">
              <input
                type="checkbox"
                checked={useCustomUrls}
                disabled={running}
                onChange={(e) => setUseCustomUrls(e.target.checked)}
              />
              Edit raw URLs manually
            </label>
          </section>

          <section className="card">
            <h2>Run settings</h2>
            <div className="quantity-block">
              <div className="quantity-head">
                <label>Jobs per platform</label>
                <span className="quantity-num">{quantity}</span>
              </div>
              <input
                type="range"
                min={1}
                max={MAX_JOBS}
                value={quantity}
                disabled={running}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
              <input
                type="number"
                className="quantity-input"
                min={1}
                max={MAX_JOBS}
                value={quantity}
                disabled={running}
                onChange={(e) =>
                  setQuantity(
                    Math.min(MAX_JOBS, Math.max(1, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={headless}
                disabled={running}
                onChange={(e) => setHeadless(e.target.checked)}
              />
              Headless browser
            </label>
            <div className="btn-row">
              <button
                type="button"
                className="btn primary"
                disabled={running || serverBusy || selectedSites.length === 0}
                onClick={startExtract}
              >
                {running || serverBusy ? "Extracting…" : "Extract"}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!running && !serverBusy}
                onClick={cancel}
              >
                Cancel
              </button>
            </div>
            {serverBusy && !running && (
              <button type="button" className="btn reset-lock" onClick={resetServer}>
                Reset server lock
              </button>
            )}
          </section>

          <section className="card history-panel">
            <div className="history-head">
              <h2>Extraction history</h2>
              <button type="button" className="btn-mini" onClick={loadHistory}>
                Refresh
              </button>
            </div>
            <p className="section-desc">Saved in <code>output/history/</code></p>
            {viewSource === "history" && (
              <button
                type="button"
                className="btn-mini live-view"
                onClick={() => {
                  setViewSource("live");
                  setSelectedHistoryId(null);
                }}
              >
                ← Back to live view
              </button>
            )}
            <ul className="history-list">
              {historyRuns.length === 0 ? (
                <li className="history-empty">No saved runs yet</li>
              ) : (
                historyRuns.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      className={`history-item ${selectedHistoryId === run.id ? "active" : ""}`}
                      onClick={() => loadHistoryRun(run.id)}
                    >
                      <span className="history-title mono">{run.id}</span>
                      <span className="history-meta">
                        {run.totalCollected ?? 0} jobs · {run.sites?.join("+")} ·{" "}
                        <span className={`outcome-tag ${run.outcome ?? run.status}`}>
                          {run.summaryTitle ?? run.status}
                        </span>
                      </span>
                      <span className="history-meta sub">
                        {run.filters?.keywords} · {run.filters?.postedWithin}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="card url-preview">
            <h2>Generated URLs</h2>
            {linkedinOn && (
              <div className="url-box">
                <span className="url-tag li">LI</span>
                <code>{useCustomUrls ? linkedinUrl : builtUrls.linkedin}</code>
              </div>
            )}
            {indeedOn && (
              <div className="url-box">
                <span className="url-tag in">IN</span>
                <code>{useCustomUrls ? indeedUrl : builtUrls.indeed}</code>
              </div>
            )}
            {useCustomUrls && (
              <>
                <input
                  className="url-edit"
                  value={linkedinUrl}
                  disabled={running}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                />
                <input
                  className="url-edit"
                  value={indeedUrl}
                  disabled={running}
                  onChange={(e) => setIndeedUrl(e.target.value)}
                />
              </>
            )}
          </section>
        </aside>

        <main className="main">
          {runSummary && (
            <div className={`outcome-banner outcome-${runSummary.outcome}`}>
              <div className="outcome-head">
                <strong>{runSummary.title}</strong>
                <span className="mono">
                  {runSummary.collected}/{runSummary.target} ({runSummary.percent}%)
                </span>
              </div>
              <pre className="outcome-diagnosis">{runSummary.diagnosis}</pre>
            </div>
          )}

          <div className="hero-metrics">
            <div className="metric progress-metric">
              <div className="progress-ring" style={{ "--pct": progressPct }}>
                <svg viewBox="0 0 100 100">
                  <circle className="track" cx="50" cy="50" r="42" />
                  <circle className="fill" cx="50" cy="50" r="42" />
                </svg>
                <div className="ring-label">
                  <strong className="mono">
                    {running || status === "done" ? current : "0"}
                  </strong>
                  <span className="mono">/ {targetTotal || "—"}</span>
                </div>
              </div>
              <div>
                <h3>{message}</h3>
                <p>
                  {activeSite
                    ? `Active: ${activeSite}`
                    : `Posted: ${postedWithin === "custom" ? `${customHours}h` : postedWithin} · sort: ${sort}`}
                </p>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            </div>
            <div className="metric-stats">
              <div className="stat">
                <span>LinkedIn</span>
                <strong>{linkedinCount}</strong>
              </div>
              <div className="stat">
                <span>Indeed</span>
                <strong>{indeedCount}</strong>
              </div>
              <div className="stat accent">
                <span>Total</span>
                <strong>{jobs.length}</strong>
              </div>
            </div>
          </div>

          {(screenshots.linkedin || screenshots.indeed) && (
            <div className="browser-preview card">
              <h2>Puppeteer snapshot</h2>
              <div className="shots">
                {screenshots.linkedin && (
                  <figure>
                    <figcaption>LinkedIn</figcaption>
                    <img src={screenshots.linkedin} alt="LinkedIn browser view" />
                  </figure>
                )}
                {screenshots.indeed && (
                  <figure>
                    <figcaption>Indeed</figcaption>
                    <img src={screenshots.indeed} alt="Indeed browser view" />
                  </figure>
                )}
              </div>
            </div>
          )}

          <div className="results-toolbar">
            <input
              className="search-jobs"
              placeholder="Filter results…"
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
            />
            <div className="view-toggle">
              <button
                type="button"
                className={viewMode === "cards" ? "active" : ""}
                onClick={() => setViewMode("cards")}
              >
                Cards
              </button>
              <button
                type="button"
                className={viewMode === "table" ? "active" : ""}
                onClick={() => setViewMode("table")}
              >
                Table
              </button>
            </div>
          </div>

          {filteredJobs.length === 0 && !running && !serverBusy ? (
            <div className="empty card">
              <p>No jobs yet</p>
              <span>
                Set keywords, posted within (1h–30d), and quantity up to {MAX_JOBS}.
                Results stream live: 1/{quantity}, 2/{quantity}…
              </span>
            </div>
          ) : viewMode === "table" ? (
            <div className="table-wrap card">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Site</th>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={`${job.site}-${job.url}-${job.id}`}>
                      <td className="mono">{job.id}</td>
                      <td>
                        <span className={`badge ${job.site}`}>{job.site}</span>
                      </td>
                      <td>{job.title || "—"}</td>
                      <td>{job.company || "—"}</td>
                      <td>{job.location || "—"}</td>
                      <td>
                        {job.url ? (
                          <a href={job.url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="job-grid">
              {filteredJobs.map((job) => (
                <article
                  key={`${job.site}-${job.url}-${job.id}`}
                  className={`job-card ${job.site}`}
                >
                  <header>
                    <span className="mono">#{String(job.id).padStart(3, "0")}</span>
                    <span className={`badge ${job.site}`}>{job.site}</span>
                  </header>
                  <h4>{job.title || "Untitled"}</h4>
                  <p className="co">{job.company || "Unknown"}</p>
                  {job.location && <p className="loc">{job.location}</p>}
                  {job.url && (
                    <a href={job.url} target="_blank" rel="noreferrer">
                      View posting →
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}

          <ProxyPanel
            proxyReport={proxyReport}
            egressMode={egressMode}
            proxyConfigured={proxyConfigured}
          />

          <section className="card log-card">
            <h2>Activity</h2>
            <div className="log">
              {logs.map((l, i) => (
                <div key={i} className={`log-line ${l.level}`}>
                  <span className="mono">{l.t}</span> {l.text}
                </div>
              ))}
              {logs.length === 0 && (
                <div className="log-line muted">Waiting…</div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
