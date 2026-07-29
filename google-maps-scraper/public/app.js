const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let activeJobId = null;
let eventSource = null;
let proxyConfigured = false;
let routeMode = "proxy";
let reportMode = "fast";
let placesCache = [];
let queueState = { running: 0, waiting: 0, maxParallel: 5 };

const STATUS_LABELS = {
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  running: "Running",
  pending: "Pending",
  cancelled: "Cancelled",
};

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge ${status}">${escapeHtml(label)}</span>`;
}

function syncRouteUI() {
  $$("#routeToggle .route-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === routeMode);
    btn.disabled = btn.dataset.mode === "proxy" && !proxyConfigured;
  });
  const proxyBtn = $("#proxyRouteBtn");
  if (proxyBtn) {
    proxyBtn.title = proxyConfigured
      ? "Route through NodeMaven — rotate on reject"
      : "Set NODEMAVEN_API_KEY in .env";
  }
}

function syncReportModeUI() {
  $$("#reportModeToggle .route-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === reportMode);
  });
  const hint = $("#reportModeHint");
  if (!hint) return;
  if (reportMode === "detail") {
    hint.textContent =
      "Detail — opens each business page for website, phone & email. Slower (~4–6 sec per place).";
  } else {
    hint.textContent =
      "Fast — name, rating, address from list. Skips website & email; phone only if shown in list.";
  }
}

function syncUnlimitedUI() {
  const unlimited = $("#unlimitedMode")?.checked;
  $("#maxResultsSection")?.classList.toggle("hidden", unlimited);
  if ($("#unlimitedHint")) {
    $("#unlimitedHint").textContent = unlimited
      ? "On — scrape until the feed ends. Rotates proxy when Google soft-caps or rejects."
      : "Off — stop after max businesses reached.";
  }
}

function updateParallelUI(q = queueState) {
  queueState = q;
  const el = $("#parallelStatus");
  if (!el) return;

  const { running = 0, waiting = 0, maxParallel = 5 } = q;
  if (running === 0 && waiting === 0) {
    el.classList.add("hidden");
    el.classList.remove("waiting");
    return;
  }

  el.classList.remove("hidden");
  el.classList.toggle("waiting", waiting > 0);
  el.textContent =
    waiting > 0
      ? `${running} of ${maxParallel} running · ${waiting} waiting`
      : `${running} of ${maxParallel} running`;
}

async function refreshQueueStatus() {
  try {
    const res = await fetch("/api/queue");
    if (res.ok) updateParallelUI(await res.json());
  } catch {
    /* ignore */
  }
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      proxyConfigured = Boolean(data.proxy?.configured);
      if (data.queue) updateParallelUI(data.queue);
      if (routeMode === "proxy" && !proxyConfigured) routeMode = "local";
      syncRouteUI();
      const proxyNote = proxyConfigured ? " · NodeMaven ready" : "";
      $("#serverStatus").textContent = `Server online${proxyNote}`;
      $("#serverStatus").classList.add("online");
    }
  } catch {
    $("#serverStatus").textContent = "Server offline";
  }
}

function openHistoryPanel() {
  $("#historyPanel")?.classList.remove("hidden");
  $("#historyBackdrop")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeHistoryPanel() {
  $("#historyPanel")?.classList.add("hidden");
  $("#historyBackdrop")?.classList.add("hidden");
  document.body.style.overflow = "";
}

function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("#tabResults").classList.toggle("hidden", name !== "results");
  $("#tabLogs").classList.toggle("hidden", name !== "logs");
}

function renderLogLine(log) {
  const line = document.createElement("div");
  line.className = `log-line ${log.level}`;
  const time = new Date(log.created_at).toLocaleTimeString();
  line.innerHTML = `
    <span class="time">${time}</span>
    <span class="lvl">[${log.level.toUpperCase()}]</span>
    ${escapeHtml(log.message)}
    ${log.detail ? `<span class="detail">${escapeHtml(log.detail)}</span>` : ""}
  `;
  return line;
}

function appendLog(log) {
  const panel = $("#logPanel");
  panel.appendChild(renderLogLine(log));
  panel.scrollTop = panel.scrollHeight;
}

function updateStats(job) {
  $("#statCollected").textContent = job.collected_count ?? 0;
  $("#statScrolls").textContent = job.scroll_rounds ?? 0;
  $("#statRotations").textContent = job.rotation_attempts ?? 0;
  $("#statRejects").textContent = job.reject_count ?? 0;
}

function hasValue(val) {
  return Boolean(val && String(val).trim() && val !== "—");
}

function passesFilters(p) {
  const text = ($("#tableFilter")?.value ?? "").trim().toLowerCase();
  if (text) {
    const hay = [p.name, p.category, p.phone, p.website, p.email, p.address, p.rating]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(text)) return false;
  }

  const minRating = parseFloat($("#filterRating")?.value ?? "");
  if (!Number.isNaN(minRating) && minRating > 0) {
    const r = parseFloat(p.rating);
    if (Number.isNaN(r) || r < minRating) return false;
  }

  const phoneFilter = $("#filterPhone")?.value ?? "";
  if (phoneFilter === "yes" && !hasValue(p.phone)) return false;
  if (phoneFilter === "no" && hasValue(p.phone)) return false;

  const websiteFilter = $("#filterWebsite")?.value ?? "";
  if (websiteFilter === "yes" && !hasValue(p.website)) return false;
  if (websiteFilter === "no" && hasValue(p.website)) return false;

  const emailFilter = $("#filterEmail")?.value ?? "";
  if (emailFilter === "yes" && !hasValue(p.email)) return false;
  if (emailFilter === "no" && hasValue(p.email)) return false;

  return true;
}

function contactCell(value, type) {
  if (!hasValue(value)) return `<span class="missing-badge">—</span>`;
  if (type === "website") {
    const href = value.startsWith("http") ? value : `https://${value}`;
    let label = value;
    try {
      label = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw */
    }
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="maps-link">${escapeHtml(label)}</a>`;
  }
  if (type === "email") {
    return `<a href="mailto:${escapeHtml(value)}" class="maps-link">${escapeHtml(value)}</a>`;
  }
  return `<span class="mono">${escapeHtml(value)}</span>`;
}

function renderResultsTable(places) {
  const tbody = $("#resultsBody");
  tbody.innerHTML = "";

  const rows = places.filter(passesFilters);
  const countEl = $("#filterCount");
  if (countEl) {
    countEl.textContent =
      rows.length === places.length
        ? `${places.length} shown`
        : `${rows.length} of ${places.length} shown`;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No results match filters…</td></tr>`;
    return;
  }

  for (const p of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${p.position}</td>
      <td class="name-cell">
        <div>${escapeHtml(p.name)}</div>
        ${p.category ? `<div class="sub-cell">${escapeHtml(p.category)}</div>` : ""}
      </td>
      <td>${p.rating ? `${escapeHtml(p.rating)}★` : "—"}</td>
      <td>${contactCell(p.phone, "phone")}</td>
      <td>${contactCell(p.website, "website")}</td>
      <td>${contactCell(p.email, "email")}</td>
      <td class="addr-cell">${escapeHtml(p.address || "—")}</td>
      <td><a href="${escapeHtml(p.maps_url)}" target="_blank" rel="noopener" class="maps-link">Open</a></td>
    `;
    tbody.appendChild(tr);
  }
}

function renderJob(job) {
  $("#welcomeView").classList.add("hidden");
  $("#jobView").classList.remove("hidden");

  const title = `"${job.query}"${job.location ? ` · ${job.location}` : ""}`;
  $("#jobTitle").textContent = title;

  const route = job.proxy_mode ? "Proxy" : "Local";
  const mode = job.unlimited ? "Unlimited" : `Max ${job.max_results}`;
  const report = job.detail_report ? "Detail" : "Fast";
  $("#jobMeta").innerHTML = `${statusBadge(job.status)} · ${report} · ${mode} · ${route} · ${formatTime(job.created_at)}`;

  const reportBanner = $("#reportModeBanner");
  if (reportBanner) {
    if (job.detail_report) {
      reportBanner.classList.add("hidden");
    } else {
      reportBanner.classList.remove("hidden");
      reportBanner.innerHTML =
        "<strong>Fast report</strong> — website &amp; email columns are not collected. Phone only when visible in the search list.";
    }
  }

  updateStats(job);
  placesCache = job.places ?? [];
  renderResultsTable(placesCache);

  const logPanel = $("#logPanel");
  logPanel.innerHTML = "";
  for (const log of job.logs ?? []) {
    logPanel.appendChild(renderLogLine(log));
  }
  logPanel.scrollTop = logPanel.scrollHeight;

  const running = job.status === "running" || job.status === "pending";
  $("#stopBtn").classList.toggle("hidden", !running);

  const exportBtn = $("#exportBtn");
  if (job.export_csv && !running) {
    exportBtn.href = `/api/jobs/${job.id}/export.csv`;
    exportBtn.download = job.export_csv;
    exportBtn.classList.remove("hidden");
  } else {
    exportBtn.classList.add("hidden");
  }

  const failureBanner = $("#failureBanner");
  const rejectBanner = $("#rejectBanner");
  failureBanner.classList.add("hidden");
  rejectBanner.classList.add("hidden");

  if (job.status === "pending") {
    rejectBanner.textContent = `Queued — waiting for a parallel slot (${queueState.running} of ${queueState.maxParallel} running)`;
    rejectBanner.classList.remove("hidden");
  } else if (job.failure_reason && job.status === "failed") {
    failureBanner.textContent = job.failure_reason;
    failureBanner.classList.remove("hidden");
  } else if (job.reject_count > 0) {
    rejectBanner.textContent = `${job.reject_count} reject(s) detected — proxy rotation was used to continue.`;
    rejectBanner.classList.remove("hidden");
  }
}

async function selectJob(id) {
  activeJobId = id;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) return;
  const job = await res.json();
  renderJob(job);

  if (job.status === "running" || job.status === "pending") {
    connectStream(id);
  }
}

function connectStream(id) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/jobs/${id}/stream`);

  eventSource.onmessage = (ev) => {
    const data = JSON.parse(ev.data);

    if (data.type === "log" && data.log) appendLog(data.log);

    if (data.type === "place" && data.place) {
      placesCache.push({
        id: data.place.id,
        position: data.place.position,
        name: data.place.name,
        category: data.place.category,
        rating: data.place.rating,
        phone: data.place.phone,
        website: data.place.website,
        email: data.place.email,
        address: data.place.address,
        maps_url: data.place.maps_url,
      });
      renderResultsTable(placesCache);
      $("#statCollected").textContent = placesCache.length;
    }

    if (data.type === "progress") {
      $("#statCollected").textContent = data.collected_count ?? placesCache.length;
      $("#statScrolls").textContent = data.scroll_rounds ?? 0;
    }

    if (data.type === "reject") {
      const rejectBanner = $("#rejectBanner");
      rejectBanner.textContent = `Reject: ${(data.reasons || []).join(", ")} — rotating proxy… (${data.collected ?? 0} saved)`;
      rejectBanner.classList.remove("hidden");
      const n = Number($("#statRejects").textContent) + 1;
      $("#statRejects").textContent = n;
    }

    if (data.type === "done") {
      eventSource.close();
      eventSource = null;
      refreshQueueStatus();
      selectJob(id);
      loadHistory();
    }
  };
}

async function loadHistory() {
  const res = await fetch("/api/jobs");
  if (!res.ok) return;
  const jobs = await res.json();
  const list = $("#historyList");

  if (!jobs.length) {
    list.innerHTML = `<div class="empty" style="padding:24px"><div class="empty-icon">📂</div>No scrapes yet</div>`;
    return;
  }

  list.innerHTML = "";
  for (const j of jobs) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `history-item${j.id === activeJobId ? " active" : ""}`;
    item.innerHTML = `
      <div class="history-item-top">
        <strong>${escapeHtml(j.query)}</strong>
        ${statusBadge(j.status)}
      </div>
      <div class="history-item-meta">
        ${j.detail_report ? "Detail" : "Fast"} · ${escapeHtml(j.location || "Any location")} · ${j.collected_count ?? 0} places
        ${j.reject_count ? ` · ${j.reject_count} reject(s)` : ""}
      </div>
      <div class="history-item-time">${formatTime(j.created_at)}</div>
    `;
    item.addEventListener("click", () => {
      closeHistoryPanel();
      selectJob(j.id);
    });
    list.appendChild(item);
  }
}

$("#historyBtn")?.addEventListener("click", () => {
  openHistoryPanel();
  loadHistory();
});
$("#historyClose")?.addEventListener("click", closeHistoryPanel);
$("#historyBackdrop")?.addEventListener("click", closeHistoryPanel);

$$("#reportModeToggle .route-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    reportMode = btn.dataset.mode;
    syncReportModeUI();
  });
});

$$("#routeToggle .route-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === "proxy" && !proxyConfigured) {
      alert("Set NODEMAVEN_API_KEY in .env (same as job-scraper-test).");
      return;
    }
    routeMode = btn.dataset.mode;
    syncRouteUI();
  });
});

$("#unlimitedMode")?.addEventListener("change", syncUnlimitedUI);
syncUnlimitedUI();
syncRouteUI();
syncReportModeUI();

const maxResultsSlider = $("#maxResults");
const maxResultsLabel = $("#maxResultsLabel");
maxResultsSlider?.addEventListener("input", () => {
  maxResultsLabel.textContent = maxResultsSlider.value;
  $$(".preset-btns button").forEach((b) => b.classList.remove("active"));
});

$$(".preset-btns button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!maxResultsSlider) return;
    maxResultsSlider.value = btn.dataset.max;
    maxResultsLabel.textContent = btn.dataset.max;
    $$(".preset-btns button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

const maxRotationsSlider = $("#maxRotations");
const maxRotationsLabel = $("#maxRotationsLabel");
maxRotationsSlider?.addEventListener("input", () => {
  maxRotationsLabel.textContent = maxRotationsSlider.value;
});

$("#tableFilter")?.addEventListener("input", () => renderResultsTable(placesCache));
["filterRating", "filterPhone", "filterWebsite", "filterEmail"].forEach((id) => {
  $("#" + id)?.addEventListener("change", () => renderResultsTable(placesCache));
});

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

$("#searchForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("#query").value.trim();
  const location = $("#location").value.trim();
  const unlimited = $("#unlimitedMode").checked;
  const maxResults = Number($("#maxResults").value);
  const maxRotations = Number($("#maxRotations").value);

  const btn = $("#submitBtn");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        location,
        unlimited,
        maxResults,
        maxRotations,
        proxyMode: routeMode === "proxy",
        detailReport: reportMode === "detail",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.reason || data.error || "Could not start job");
      return;
    }
    if (data.queue) updateParallelUI(data.queue);
    await selectJob(data.id);
    loadHistory();
    refreshQueueStatus();
  } catch (err) {
    alert("Server error: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

$("#stopBtn")?.addEventListener("click", async () => {
  if (!activeJobId) return;
  $("#stopBtn").disabled = true;
  await fetch(`/api/jobs/${activeJobId}/cancel`, { method: "POST" });
  $("#stopBtn").disabled = false;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#historyPanel")?.classList.contains("hidden")) {
    closeHistoryPanel();
  }
});

checkHealth();
refreshQueueStatus();
setInterval(checkHealth, 30000);
setInterval(refreshQueueStatus, 3000);
