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
        <h2>Proxy · Webshare</h2>
        <span
          className={`pill ${proxyConfigured ? "live" : "warn"}`}
        >
          {egressMode === "proxy"
            ? proxyConfigured
              ? "● Proxy active"
              : "Credentials missing"
            : "Local (no proxy)"}
        </span>
      </div>

      {!proxyConfigured && egressMode === "proxy" && (
        <p className="proxy-hint">
          Add <code className="mono">WEBSHARE_API_KEY</code> to{" "}
          <code className="mono">job-scraper-test/.env</code> (get from{" "}
          <a href="https://proxy.webshare.io/" target="_blank" rel="noreferrer">proxy.webshare.io</a>).
          Restart the API server.
        </p>
      )}

      {report.totalProxies > 0 && (
        <p className="proxy-hint muted">
          {report.totalProxies} proxies available
          {report.countryFilter && report.countryFilter !== "any"
            ? ` (filtered: ${report.countryFilter})`
            : ""}
        </p>
      )}

      {summary && (
        <div className="proxy-summary-grid">
          <div className="proxy-stat">
            <span>Rotations</span>
            <strong>{summary.rotationsUsed ?? report.totalRotations ?? 0}</strong>
          </div>
          <div className="proxy-stat">
            <span>Unique egress IPs</span>
            <strong>{summary.uniqueEgressIps ?? 0}</strong>
          </div>
          <div className="proxy-stat">
            <span>Geo target</span>
            <strong className="mono">
              {summary.locationLabel ?? summary.countriesTargeted?.join(", ") ?? "—"}
            </strong>
          </div>
          <div className="proxy-stat">
            <span>IP checks</span>
            <strong>
              {summary.allIpChecksOk ? "All OK" : "Some failed"}
            </strong>
          </div>
          {summary.avgIpCheckMs != null && (
            <div className="proxy-stat">
              <span>Avg IP check</span>
              <strong>{summary.avgIpCheckMs} ms</strong>
            </div>
          )}
          {report.host && (
            <div className="proxy-stat">
              <span>Gateway</span>
              <strong className="mono">
                {report.host}:{report.port}
              </strong>
            </div>
          )}
        </div>
      )}

      {rotations.length > 0 && (
        <>
          <h3 className="proxy-subhead">Rotations ({rotations.length})</h3>
          <div className="proxy-rotations">
            {rotations.map((r) => (
              <details key={`${r.index}-${r.site}`} className="proxy-rotation" open={rotations.length <= 2}>
                <summary>
                  <span className="mono">#{r.index}</span>{" "}
                  <span className={`badge ${r.site}`}>{r.site}</span>{" "}
                  {r.egressIp ? (
                    <span className="mono">{r.egressIp}</span>
                  ) : (
                    <span className="muted">IP pending</span>
                  )}{" "}
                  <span className={`proxy-status ${r.status}`}>{r.status}</span>
                </summary>
                <dl className="proxy-dl">
                  <dt>Session ID</dt>
                  <dd className="mono">{r.sessionId ?? "—"}</dd>
                  <dt>Username</dt>
                  <dd className="mono">{r.username ?? "—"}</dd>
                  <dt>Country</dt>
                  <dd>
                    {r.countryCode ?? "—"}
                    {r.cityName ? ` · ${r.cityName}` : ""}
                  </dd>
                  <dt>Proxy</dt>
                  <dd className="mono">{r.proxyAddress ?? "—"}:{r.port ?? "—"}</dd>
                  <dt>Egress</dt>
                  <dd>
                    {r.egressIp ? (
                      <>
                        {r.egressIp}
                        {r.egressCity && ` · ${r.egressCity}`}
                        {r.egressRegion && `, ${r.egressRegion}`}
                        {r.egressCountry && ` (${r.egressCountry})`}
                        {r.egressOrg && (
                          <span className="muted block">{r.egressOrg}</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt>IP check</dt>
                  <dd>
                    {r.ipCheckOk ? "OK" : r.ipCheckError ?? "Failed"}{" "}
                    {r.ipCheckMs != null && (
                      <span className="muted">({r.ipCheckMs} ms)</span>
                    )}
                  </dd>
                  <dt>Jobs scraped</dt>
                  <dd>{r.scrapeJobs ?? 0}</dd>
                  <dt>Started</dt>
                  <dd className="mono">{r.startedAt ?? "—"}</dd>
                  <dt>Ended</dt>
                  <dd className="mono">{r.endedAt ?? "—"}</dd>
                </dl>
              </details>
            ))}
          </div>
        </>
      )}

      {summary && (
        <div className="proxy-docs">
          <span>Docs:</span>{" "}
          <a href="https://proxy.webshare.io/api/v2/" target="_blank" rel="noreferrer">
            Webshare API
          </a>
          {" · "}
          <a href="https://proxy.webshare.io/" target="_blank" rel="noreferrer">
            Dashboard
          </a>
        </div>
      )}
    </section>
  );
}
