function WebsiteBadge({ hasWebsite }) {
  return (
    <span
      className={`website-badge ${hasWebsite ? "yes" : "no"}`}
      title={hasWebsite ? "Has company website" : "Directory / social / no site"}
    >
      {hasWebsite ? "✓" : "✗"}
    </span>
  );
}

export default function ResultsTable({
  results,
  onRowClick,
  compact = false,
}) {
  if (!results.length) {
    return (
      <div className="empty-table">
        <p>No results yet. Run a search to populate the table.</p>
      </div>
    );
  }

  return (
    <div className={`table-wrap ${compact ? "compact" : ""}`}>
      <table className="results-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Domain</th>
            {!compact && <th>Snippet</th>}
            <th>Website</th>
            <th>Remarks</th>
            <th>Pg</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr
              key={r.id}
              className="clickable-row"
              onClick={() => onRowClick?.(r)}
            >
              <td className="mono">{r.position}</td>
              <td className="title-cell">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.title}
                </a>
              </td>
              <td className="mono domain-cell">{r.domain}</td>
              {!compact && (
                <td className="snippet-cell">{r.snippet || "—"}</td>
              )}
              <td className="center">
                <WebsiteBadge hasWebsite={r.hasWebsite} />
              </td>
              <td className="remarks-preview">
                {r.remarks ? (
                  <span title={r.remarks}>{r.remarks.slice(0, 40)}{r.remarks.length > 40 ? "…" : ""}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="mono center">{r.page}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
