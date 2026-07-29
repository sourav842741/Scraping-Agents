export default function ProxyPanel({ proxyReport, egressMode, proxyConfigured }) {
  if (egressMode !== "proxy" && !proxyReport?.totalRotations) {
    return null;
  }

  const report = proxyReport ?? {
    mode: egressMode,
    totalRotations: 0,
    rotations: [],
    summary: null,
  };

  const summary = report.summary;
  const rotations = report.rotations ?? [];

  return (
    <section className="card proxy-card">
      <div className="proxy-card-head">
        <h2>Proxy · NodeMaven</h2>
        <span className={`pill ${proxyConfigured ? "live" : "warn"}`}>
          {egressMode === "proxy"
            ? proxyConfigured
              ? "● Proxy active"
              : "Credentials missing"
            : "Local (no proxy)"}
        </span>
      </div>

      {!proxyConfigured && egressMode === "proxy" && (
        <p className="proxy-hint">
          Add <code className="mono">NODEMAVEN_API_KEY</code> to{" "}
          <code className="mono">google-search-scraper/.env</code> and restart
          the server.
        </p>
      )}

      {summary && (
        <div className="proxy-summary-grid">
          <div className="proxy-stat">
            <span>Rotations</span>
            <strong>{summary.rotationsUsed ?? report.totalRotations ?? 0}</strong>
          </div>
          <div className="proxy-stat">
            <span>Unique IPs</span>
            <strong>{summary.uniqueEgressIps ?? 0}</strong>
          </div>
          <div className="proxy-stat">
            <span>Geo</span>
            <strong className="mono">
              {summary.locationLabel ?? "—"}
            </strong>
          </div>
        </div>
      )}

      {rotations.length > 0 && (
        <div className="proxy-rotations">
          {rotations.map((r) => (
            <div key={r.index} className="proxy-rotation">
              <span className="mono">#{r.index}</span>
              <span>{r.egressIp ?? "—"}</span>
              <span className="muted">
                {r.egressCity ? `${r.egressCity}, ` : ""}
                {r.egressCountry ?? r.countryLabel}
              </span>
              <span className="muted">{r.scrapeJobs ?? 0} results</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
