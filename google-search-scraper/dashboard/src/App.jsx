import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProxyPanel from "./components/ProxyPanel.jsx";
import ResultsTable from "./components/ResultsTable.jsx";
import FullViewModal from "./components/FullViewModal.jsx";

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function App() {
  const [query, setQuery] = useState("digital marketing agency");
  const [location, setLocation] = useState("India");
  const [maxResults, setMaxResults] = useState(500);
  const [scrapeAll, setScrapeAll] = useState(true);
  const [headless, setHeadless] = useState(true);
  const [egressMode, setEgressMode] = useState("proxy");
  const [proxyConfigured, setProxyConfigured] = useState(false);
  const [downloadDir, setDownloadDir] = useState("");
  const [builtUrl, setBuiltUrl] = useState("");

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Configure search and extract");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState([]);
  const [logs, setLogs] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [viewSource, setViewSource] = useState("live");
  const [runId, setRunId] = useState(null);
  const [runSummary, setRunSummary] = useState(null);
  const [proxyReport, setProxyReport] = useState(null);
  const [fullViewOpen, setFullViewOpen] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [csvSavedPath, setCsvSavedPath] = useState(null);

  const eventSourceRef = useRef(null);
  const extractLockRef = useRef(false);

  const pushLog = useCallback((text, level = "info") => {
    setLogs((prev) => [{ t: formatTime(), text, level }, ...prev.slice(0, 99)]);
  }, []);

  const activeRunId = viewSource === "history" ? selectedHistoryId : runId;

  const displayResults = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return results;
    return results.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.domain?.toLowerCase().includes(q) ||
        r.snippet?.toLowerCase().includes(q) ||
        r.remarks?.toLowerCase().includes(q)
    );
  }, [results, tableFilter]);

  const stats = useMemo(() => {
    const withWebsite = results.filter((r) => r.hasWebsite).length;
    return {
      total: results.length,
      withWebsite,
      withoutWebsite: results.length - withWebsite,
    };
  }, [results]);

  const progressPct = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.defaults) {
          const d = cfg.defaults;
          setQuery(d.query ?? query);
          setLocation(d.location ?? location);
          setMaxResults(d.maxResults ?? maxResults);
          setScrapeAll(d.scrapeAll ?? scrapeAll);
          setHeadless(d.headless ?? headless);
          if (d.proxyMode !== false) setEgressMode("proxy");
        }
        if (cfg.built) setBuiltUrl(cfg.built);
        if (cfg.proxy) setProxyConfigured(Boolean(cfg.proxy.configured));
        if (cfg.settings?.downloadDir) setDownloadDir(cfg.settings.downloadDir);
        else if (cfg.defaultDownloadDir) setDownloadDir(cfg.defaultDownloadDir);
      })
      .catch(() => {});
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      setHistoryRuns(data.runs ?? []);
    } catch {
      /* ignore */
    }
  }

  async function saveDownloadDir() {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ downloadDir }),
      });
      const data = await res.json();
      setDownloadDir(data.downloadDir);
      pushLog(`Download folder set: ${data.downloadDir}`, "success");
    } catch (err) {
      pushLog(`Failed to save folder: ${err.message}`, "error");
    }
  }

  async function loadHistoryRun(id) {
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) return;
      const run = await res.json();
      setSelectedHistoryId(id);
      setViewSource("history");
      setResults(run.results ?? []);
      setRunSummary(run.summary ?? null);
      setRunId(id);
      setQuery(run.filters?.query ?? run.query ?? query);
      setLocation(run.filters?.location ?? location);
      setMessage(`Loaded history: ${run.summary?.title ?? id}`);
      pushLog(`History loaded · ${run.results?.length ?? 0} results`, "info");
    } catch {
      pushLog("Failed to load history run", "error");
    }
  }

  function handleRemarksSaved(updated) {
    setResults((prev) =>
      prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
    );
    pushLog(`Remarks saved for #${updated.position}`, "success");
  }

  async function downloadCsv() {
    const id = activeRunId;
    if (!id || !results.length) {
      pushLog("No run to export", "warn");
      return;
    }
    try {
      const res = await fetch(`/api/export/csv?runId=${encodeURIComponent(id)}`);
      if (!res.ok) {
        const err = await res.json();
        pushLog(err.error ?? "Export failed", "error");
        return;
      }
      const savedPath = res.headers.get("X-Saved-Path");
      if (savedPath) setCsvSavedPath(savedPath);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `google-search-${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      pushLog(
        savedPath ? `CSV saved to ${savedPath}` : "CSV downloaded",
        "success"
      );
    } catch (err) {
      pushLog(`CSV export failed: ${err.message}`, "error");
    }
  }

  function stopStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  async function startExtract() {
    if (extractLockRef.current || running) return;
    if (!query.trim()) {
      pushLog("Enter a search query", "warn");
      return;
    }
    if (egressMode === "proxy" && !proxyConfigured) {
      pushLog("Proxy selected but NodeMaven not configured", "error");
      return;
    }

    extractLockRef.current = true;
    stopStream();
    setRunning(true);
    setStatus("running");
    setViewSource("live");
    setSelectedHistoryId(null);
    setResults([]);
    setCurrent(0);
    setTotal(scrapeAll ? 1000 : maxResults);
    setRunSummary(null);
    setProxyReport(null);
    setCsvSavedPath(null);
    setMessage("Starting extraction…");

    const params = new URLSearchParams({
      query: query.trim(),
      location: location.trim(),
      maxResults: String(maxResults),
      scrapeAll: String(scrapeAll),
      headless: String(headless),
      proxyMode: String(egressMode === "proxy"),
    });

    const es = new EventSource(`/api/extract/stream?${params}`);
    eventSourceRef.current = es;

    es.addEventListener("run-start", (e) => {
      const data = JSON.parse(e.data);
      setRunId(data.runId);
      if (data.built) setBuiltUrl(data.built);
      if (data.proxyReport) setProxyReport(data.proxyReport);
      setTotal(data.scrapeAll ? 1000 : data.maxResults);
      pushLog(`Run ${data.runId} started`, "success");
    });

    es.addEventListener("log", (e) => {
      const entry = JSON.parse(e.data);
      pushLog(entry.text, entry.level ?? "info");
    });

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data);
      setCurrent(data.current);
      setResults((prev) => {
        const exists = prev.some((r) => r.id === data.result.id);
        if (exists) return prev;
        return [...prev, data.result];
      });
    });

    es.addEventListener("proxy-report", (e) => {
      const data = JSON.parse(e.data);
      if (data.proxyReport) setProxyReport(data.proxyReport);
    });

    es.addEventListener("run-complete", (e) => {
      const data = JSON.parse(e.data);
      setResults((prev) => {
        const incoming = data.results ?? [];
        return incoming.map((r) => {
          const existing = prev.find((p) => p.id === r.id || p.url === r.url);
          return existing?.remarks ? { ...r, remarks: existing.remarks } : r;
        });
      });
      setRunSummary(data.summary ?? null);
      setStatus(data.status ?? "completed");
      setMessage(data.summary?.title ?? "Complete");
      if (data.proxyReport) setProxyReport(data.proxyReport);
      setRunning(false);
      extractLockRef.current = false;
      loadHistory();
      stopStream();
    });

    es.addEventListener("error", (e) => {
      try {
        const data = JSON.parse(e.data);
        pushLog(data.message ?? "Error", "error");
        setMessage(data.message ?? "Error");
      } catch {
        if (es.readyState === EventSource.CLOSED) {
          setRunning(false);
          extractLockRef.current = false;
        }
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setRunning(false);
        extractLockRef.current = false;
        stopStream();
      }
    };
  }

  async function cancelExtract() {
    await fetch("/api/extract/cancel", { method: "POST" });
    stopStream();
    setRunning(false);
    extractLockRef.current = false;
    pushLog("Cancelled", "warn");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo">
            <svg viewBox="0 0 44 44" fill="none">
              <rect width="44" height="44" rx="12" fill="url(#g)" />
              <path
                d="M22 10c-6.6 0-12 5.4-12 12s5.4 12 12 12 12-5.4 12-12-5.4-12-12-12zm0 4c1.1 0 2 .9 2 2v6h6c1.1 0 2 .9 2 2s-.9 2-2 2h-6v6c0 1.1-.9 2-2 2s-2-.9-2-2v-6h-6c-1.1 0-2-.9-2-2s.9-2 2-2h6v-6c0-1.1.9-2 2-2z"
                fill="#fff"
                opacity="0.9"
              />
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="44" y2="44">
                  <stop stopColor="#4285F4" />
                  <stop offset="0.5" stopColor="#34A853" />
                  <stop offset="1" stopColor="#FBBC05" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <h1>Google Search OS</h1>
            <p>Search · table · proxy · history · CSV</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="egress-toggle">
            <button
              type="button"
              className={egressMode === "local" ? "active" : ""}
              disabled={running}
              onClick={() => setEgressMode("local")}
            >
              Local system
            </button>
            <button
              type="button"
              className={egressMode === "proxy" ? "active" : ""}
              disabled={running}
              onClick={() => setEgressMode("proxy")}
            >
              Proxy
            </button>
          </div>
          <span className={`pill ${running ? "live" : ""}`}>
            {running ? "● Extracting" : status}
          </span>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <section className="card">
            <h2>Search</h2>
            <label className="field">
              <span>Query</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={running}
                placeholder="e.g. digital marketing agency Mumbai"
              />
            </label>
            <label className="field">
              <span>Location bias</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={running}
                placeholder="India, United States…"
              />
            </label>

            <label className="field checkbox">
              <input
                type="checkbox"
                checked={scrapeAll}
                onChange={(e) => setScrapeAll(e.target.checked)}
                disabled={running}
              />
              <span>Scrape to end (all pages)</span>
            </label>

            {!scrapeAll && (
              <label className="field">
                <span>Max results</span>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={maxResults}
                  onChange={(e) => setMaxResults(Number(e.target.value))}
                  disabled={running}
                />
              </label>
            )}

            <label className="field checkbox">
              <input
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                disabled={running}
              />
              <span>Headless browser</span>
            </label>

            {builtUrl && (
              <p className="built-url mono" title={builtUrl}>
                {builtUrl.slice(0, 60)}…
              </p>
            )}

            <div className="btn-row">
              {!running ? (
                <button type="button" className="btn primary" onClick={startExtract}>
                  Extract
                </button>
              ) : (
                <button type="button" className="btn danger" onClick={cancelExtract}>
                  Cancel
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Download</h2>
            <label className="field">
              <span>Save CSV to (Desktop folder)</span>
              <input
                value={downloadDir}
                onChange={(e) => setDownloadDir(e.target.value)}
                placeholder="/Users/you/Desktop"
                className="mono"
              />
            </label>
            <button type="button" className="btn ghost sm" onClick={saveDownloadDir}>
              Save folder
            </button>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn secondary"
                disabled={!results.length}
                onClick={downloadCsv}
              >
                Download CSV
              </button>
            </div>
            {csvSavedPath && (
              <p className="hint success mono">{csvSavedPath}</p>
            )}
          </section>

          <section className="card history-card">
            <h2>History</h2>
            <div className="history-list">
              {historyRuns.length === 0 && (
                <p className="muted">No runs yet</p>
              )}
              {historyRuns.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`history-item ${selectedHistoryId === h.id ? "active" : ""}`}
                  onClick={() => loadHistoryRun(h.id)}
                >
                  <strong>{h.query?.slice(0, 36) || h.id}</strong>
                  <span>
                    {h.totalCollected} results · {h.outcome}
                  </span>
                  <span className="muted mono">
                    {h.startedAt?.slice(0, 19).replace("T", " ")}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <ProxyPanel
            proxyReport={proxyReport}
            egressMode={egressMode}
            proxyConfigured={proxyConfigured}
          />
        </aside>

        <div className="main-panel">
          <section className="card progress-card">
            <div className="progress-head">
              <div>
                <h2>{message}</h2>
                {runSummary && (
                  <p className="muted">{runSummary.diagnosis?.split("\n")[0]}</p>
                )}
              </div>
              <div className="stats-row">
                <div className="stat">
                  <span>Total</span>
                  <strong>{stats.total}</strong>
                </div>
                <div className="stat success-stat">
                  <span>Website ✓</span>
                  <strong>{stats.withWebsite}</strong>
                </div>
                <div className="stat warn-stat">
                  <span>Website ✗</span>
                  <strong>{stats.withoutWebsite}</strong>
                </div>
              </div>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mono muted">
              {running ? `${current} / ${total}+` : `${stats.total} results`}
              {viewSource === "history" && " · history view"}
            </p>
          </section>

          <section className="card table-card">
            <div className="table-toolbar">
              <h2>Results table</h2>
              <div className="table-actions">
                <input
                  type="search"
                  placeholder="Filter table…"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  className="search-input sm"
                />
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={!results.length}
                  onClick={() => setFullViewOpen(true)}
                >
                  Full view
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={!results.length}
                  onClick={downloadCsv}
                >
                  CSV
                </button>
              </div>
            </div>
            <ResultsTable
              results={displayResults}
              onRowClick={() => setFullViewOpen(true)}
            />
          </section>

          <section className="card logs-card">
            <h2>Activity</h2>
            <div className="logs">
              {logs.map((l, i) => (
                <div key={i} className={`log log-${l.level}`}>
                  <span className="mono">{l.t}</span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <FullViewModal
        open={fullViewOpen}
        results={displayResults}
        runId={activeRunId}
        onClose={() => setFullViewOpen(false)}
        onRemarksSaved={handleRemarksSaved}
      />
    </div>
  );
}
