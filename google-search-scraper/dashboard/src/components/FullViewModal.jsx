import { useEffect, useState } from "react";

export default function FullViewModal({
  open,
  results,
  runId,
  onClose,
  onRemarksSaved,
}) {
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [remarksDraft, setRemarksDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setEditingId(null);
    }
  }, [open]);

  if (!open) return null;

  const q = filter.trim().toLowerCase();
  const filtered = results.filter(
    (r) =>
      !q ||
      r.title?.toLowerCase().includes(q) ||
      r.domain?.toLowerCase().includes(q) ||
      r.snippet?.toLowerCase().includes(q) ||
      r.remarks?.toLowerCase().includes(q)
  );

  const withWebsite = results.filter((r) => r.hasWebsite).length;
  const withoutWebsite = results.length - withWebsite;

  async function saveRemarks(resultId) {
    setSaving(true);
    try {
      if (runId) {
        const res = await fetch(`/api/history/${runId}/remarks`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultId, remarks: remarksDraft }),
        });
        if (res.ok) {
          const data = await res.json();
          onRemarksSaved?.(data.result);
          setEditingId(null);
          return;
        }
      }
      onRemarksSaved?.({
        id: resultId,
        remarks: remarksDraft,
        remarksUpdatedAt: new Date().toISOString(),
      });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal full-view-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Full table view</h2>
            <p className="muted">
              {results.length} results · {withWebsite} with website ·{" "}
              {withoutWebsite} without
            </p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-toolbar">
          <input
            type="search"
            placeholder="Filter by title, domain, snippet, remarks…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="full-view-table-wrap">
          <table className="results-table full">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Domain</th>
                <th>URL</th>
                <th>Snippet</th>
                <th>Website</th>
                <th>Remarks</th>
                <th>Pg</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.position}</td>
                  <td>{r.title}</td>
                  <td className="mono">{r.domain}</td>
                  <td className="url-cell">
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.url}
                    </a>
                  </td>
                  <td className="snippet-cell">{r.snippet || "—"}</td>
                  <td className="center">
                    <span
                      className={`website-badge ${r.hasWebsite ? "yes" : "no"}`}
                    >
                      {r.hasWebsite ? "✓" : "✗"}
                    </span>
                  </td>
                  <td className="remarks-cell">
                    {editingId === r.id ? (
                      <div className="remarks-edit">
                        <textarea
                          value={remarksDraft}
                          onChange={(e) => setRemarksDraft(e.target.value)}
                          rows={3}
                          placeholder="Add notes about this company, outreach status, conversation context…"
                        />
                        <div className="remarks-actions">
                          <button
                            type="button"
                            className="btn sm primary"
                            disabled={saving || !runId}
                            onClick={() => saveRemarks(r.id)}
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="remarks-btn"
                        onClick={() => {
                          setEditingId(r.id);
                          setRemarksDraft(r.remarks ?? "");
                        }}
                      >
                        {r.remarks || (
                          <span className="muted">Add remarks…</span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="mono center">{r.page}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
