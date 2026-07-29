const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let activeJobId = null;
let eventSource = null;

const countSlider = $("#count");
const countLabel = $("#countLabel");
const parallelSlider = $("#parallel");
const parallelLabel = $("#parallelLabel");
const stopBtn = $("#stopBtn");
const autoModeToggle = $("#autoMode");
const platformGrid = $("#platformGrid");
const platformHint = $("#platformHint");
const platformInputs = () => $$("#platformGrid input[type=checkbox]");
let proxyConfigured = false;
let routeMode = "local";
let downloadMode = "review";

const DL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>`;

const PLATFORM_LABELS = {
  bing: "Bing Images",
  duckduckgo: "DuckDuckGo",
  pinterest: "Pinterest",
  unsplash: "Unsplash",
  pixabay: "Pixabay",
};

const snapshotModeToggle = $("#snapshotMode");
const parallelRow = $("#parallelRow");
const countLabelText = $("#countLabelText");
const lightbox = $("#lightbox");
const lightboxImg = $("#lightboxImg");
const lightboxPlatform = $("#lightboxPlatform");
const lightboxFilename = $("#lightboxFilename");
const lightboxOpen = $("#lightboxOpen");
const lightboxClose = $("#lightboxClose");

function platformLabel(id) {
  return PLATFORM_LABELS[id] || id || "Unknown";
}

function syncDownloadModeUI() {
  const review = downloadMode === "review";
  const snapshotOn = snapshotModeToggle?.checked;

  $("#snapshotSection")?.classList.toggle("hidden", review);
  parallelRow?.classList.toggle("hidden", review || snapshotOn);

  if ($("#downloadModeHint")) {
    $("#downloadModeHint").textContent = review
      ? "Review — search collects URLs first. Preview each result, then download only what you want."
      : "Auto — download images immediately after search.";
  }

  if (countLabelText) {
    if (snapshotOn) countLabelText.textContent = "Scroll captures per platform";
    else if (review) countLabelText.textContent = "URLs to preview";
    else countLabelText.textContent = "Number of images";
  }

  const submitBtn = $("#submitBtn");
  if (submitBtn) {
    submitBtn.textContent = snapshotOn
      ? "Capture page snapshots"
      : review
        ? "Search & preview"
        : "Launch headless download";
  }

  $$("#downloadModeToggle .route-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === downloadMode);
  });
}

function syncSnapshotUI() {
  const on = snapshotModeToggle?.checked;
  if (on && downloadMode === "review") {
    downloadMode = "auto";
  }
  if ($("#snapshotHint")) {
    $("#snapshotHint").textContent = on
      ? "Captures the visible search page while scrolling — no individual image downloads."
      : "Off — download individual images. On — scroll and capture the search results page per platform.";
  }
  syncDownloadModeUI();
}

snapshotModeToggle?.addEventListener("change", syncSnapshotUI);

$$("#downloadModeToggle .route-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    downloadMode = btn.dataset.mode;
    if (downloadMode === "review" && snapshotModeToggle?.checked) {
      snapshotModeToggle.checked = false;
    }
    syncDownloadModeUI();
  });
});

syncDownloadModeUI();
syncRouteUI();
syncSnapshotUI();

function openLightbox({ src, platform, filename, fileUrl, isSnapshot }) {
  lightboxImg.src = src;
  lightboxImg.alt = filename;
  lightboxPlatform.textContent = isSnapshot
    ? `Snapshot · ${platformLabel(platform)}`
    : `Downloaded from ${platformLabel(platform)}`;
  lightboxPlatform.className = platformPillClass(platform, isSnapshot ? "snapshot" : "");
  lightboxFilename.textContent = filename;
  lightboxOpen.href = fileUrl;
  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImg.src = "";
  document.body.style.overflow = "";
}

lightboxClose?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!lightbox.classList.contains("hidden")) closeLightbox();
  else if (!$("#historyPanel")?.classList.contains("hidden")) closeHistoryPanel();
});

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABELS = {
  awaiting_review: "Awaiting review",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  running: "Running",
  pending: "Pending",
  cancelled: "Cancelled",
};

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge ${status}">${escapeHtml(label)}</span>`;
}

function platformPillClass(platform, extra = "") {
  const id = platform && platform !== "unknown" ? ` platform-${platform}` : "";
  return `platform-pill${id}${extra ? ` ${extra}` : ""}`;
}

function getSelectedSources() {
  return [...platformInputs()]
    .filter((el) => el.checked)
    .map((el) => el.value);
}

function syncPlatformUI() {
  const auto = autoModeToggle.checked;
  platformGrid.classList.toggle("disabled", auto);
  platformInputs().forEach((el) => {
    el.disabled = auto;
    if (auto) el.checked = true;
  });
  platformHint.textContent = auto
    ? "Auto mode searches Bing, DuckDuckGo, Pinterest, Unsplash, and Pixabay."
    : "Pick which platforms to search. At least one must be selected.";
}

function syncRouteUI() {
  $$("#routeToggle .route-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === routeMode);
    btn.disabled = btn.dataset.mode === "proxy" && !proxyConfigured;
  });
  const proxyBtn = $("#proxyRouteBtn");
  if (proxyBtn) {
    proxyBtn.title = proxyConfigured
      ? "Route through Webshare — rotating IPs"
      : "Set WEBSHARE_API_KEY in .env to enable";
  }
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      proxyConfigured = Boolean(data.proxy?.configured);
      if (routeMode === "proxy" && !proxyConfigured) routeMode = "local";
      syncRouteUI();
      const proxyNote = proxyConfigured ? " · Webshare ready" : "";
      $("#serverStatus").textContent = `Server online${proxyNote}`;
      $("#serverStatus").classList.add("online");
    }
  } catch {
    $("#serverStatus").textContent = "Server offline";
  }
}

$$("#routeToggle .route-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === "proxy" && !proxyConfigured) {
      alert("Webshare not configured.\n\nSet WEBSHARE_API_KEY in .env (get from https://proxy.webshare.io/).");
      return;
    }
    routeMode = btn.dataset.mode;
    syncRouteUI();
  });
});

function openHistoryPanel() {
  $("#historyPanel")?.classList.remove("hidden");
  $("#historyBackdrop")?.classList.remove("hidden");
  $("#historyPanel")?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeHistoryPanel() {
  $("#historyPanel")?.classList.add("hidden");
  $("#historyBackdrop")?.classList.add("hidden");
  $("#historyPanel")?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

$("#historyBtn")?.addEventListener("click", () => {
  openHistoryPanel();
  loadHistory();
});
$("#historyClose")?.addEventListener("click", closeHistoryPanel);
$("#historyBackdrop")?.addEventListener("click", closeHistoryPanel);

autoModeToggle.addEventListener("change", syncPlatformUI);
platformInputs().forEach((el) => {
  el.addEventListener("change", () => {
    if (!autoModeToggle.checked && getSelectedSources().length === 0) {
      el.checked = true;
    }
  });
});
syncPlatformUI();

countSlider.addEventListener("input", () => {
  countLabel.textContent = countSlider.value;
  $$(".preset-btns button").forEach((b) => b.classList.remove("active"));
});

parallelSlider?.addEventListener("input", () => {
  parallelLabel.textContent = parallelSlider.value;
});

$$(".preset-btns button").forEach((btn) => {
  btn.addEventListener("click", () => {
    countSlider.value = btn.dataset.count;
    countLabel.textContent = btn.dataset.count;
    $$(".preset-btns button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

function switchTab(name) {
  $$(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  $("#tabGallery").classList.toggle("hidden", name !== "gallery");
  $("#tabReview").classList.toggle("hidden", name !== "review");
  $("#tabLogs").classList.toggle("hidden", name !== "logs");
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

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

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function appendLog(log) {
  const panel = $("#logPanel");
  panel.appendChild(renderLogLine(log));
  panel.scrollTop = panel.scrollHeight;
}

async function downloadCandidate(jobId, candidateId, btn) {
  btn.disabled = true;
  btn.classList.add("loading");
  btn.innerHTML = `<span class="dl-spinner"></span>`;
  try {
    const res = await fetch(`/api/jobs/${jobId}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateIds: [candidateId] }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.reason || data.error || "Download failed");
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.innerHTML = DL_ICON;
      return;
    }
    if (data.job) renderJob(data.job);
    else await selectJob(jobId);
  } catch (err) {
    alert("Could not reach server: " + err.message);
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.innerHTML = DL_ICON;
  }
}

function renderReviewGrid(job) {
  const grid = $("#reviewGrid");
  const candidates = job.candidates || [];
  grid.innerHTML = "";

  if (!candidates.length) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">🔎</div>Searching for image URLs…</div>`;
    return;
  }

  const pending = candidates.filter((c) => c.status === "pending").length;
  $("#reviewIntro").textContent =
    pending > 0
      ? `${pending} image(s) ready — use the download button on each preview.`
      : "All previews have been downloaded or skipped.";

  for (const c of candidates) {
    const card = document.createElement("div");
    const done = c.status === "downloaded";
    const failed = c.status === "failed";
    card.className = `review-card${done ? " downloaded" : ""}${failed ? " failed" : ""}`;
    const previewUrl = `/api/jobs/${job.id}/candidates/${c.id}/preview`;

    const actionHtml = done
      ? `<div class="review-saved-badge">${CHECK_ICON}<span>Saved</span></div>`
      : `<button type="button" class="review-dl-btn" title="${failed ? "Retry download" : "Download this image"}" aria-label="Download">${DL_ICON}</button>`;

    card.innerHTML = `
      <img src="${previewUrl}" alt="" loading="lazy" referrerpolicy="no-referrer"
        onerror="this.style.display='none';this.nextElementSibling?.classList.add('visible')" />
      <div class="review-status${done || failed ? " visible" : ""}">
        ${done ? `${CHECK_ICON}<span>Saved</span>` : failed ? "Failed — tap to retry" : "Preview unavailable"}
      </div>
      <span class="${platformPillClass(c.platform)}">${escapeHtml(platformLabel(c.platform))}</span>
      ${actionHtml}
    `;

    const img = card.querySelector("img");
    img?.addEventListener("click", () =>
      openLightbox({
        src: previewUrl,
        platform: c.platform,
        filename: c.url,
        fileUrl: c.url,
        isSnapshot: false,
      })
    );

    const dlBtn = card.querySelector(".review-dl-btn");
    if (dlBtn && !done) {
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadCandidate(job.id, c.id, dlBtn);
      });
    }

    grid.appendChild(card);
  }
}

function renderGallery(job) {
  const gallery = $("#gallery");
  gallery.innerHTML = "";

  const successFiles = job.files.filter((f) => f.status === "success");
  const failedFiles = job.files.filter((f) => f.status === "failed");

  if (!successFiles.length && !failedFiles.length) {
    const waitLabel = job.snapshot_mode ? "snapshots" : "downloads";
    gallery.innerHTML = `<div class="empty"><div class="empty-icon">⏳</div>Waiting for ${waitLabel}…</div>`;
    return;
  }

  for (const f of successFiles) {
    const isSnapshot = f.file_kind === "snapshot" || f.filename.startsWith("snapshot-");
    const platform =
      f.source_platform ||
      f.filename.match(/^snapshot-([a-z]+)-/)?.[1] ||
      (job.sources?.length === 1 ? job.sources[0] : null) ||
      "unknown";
    const fileUrl = `/api/files/${job.id}/${f.filename}`;
    const sizeNote = f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB` : "";

    const item = document.createElement("button");
    item.type = "button";
    item.className = `gallery-item${isSnapshot ? " snapshot-card" : ""}`;
    item.innerHTML = `
      <img src="${fileUrl}" alt="${escapeHtml(f.filename)}" loading="lazy" />
      <div class="overlay">
        <span class="${platformPillClass(platform, isSnapshot ? "snapshot" : "")}">${escapeHtml(isSnapshot ? "Snapshot" : platformLabel(platform))}</span>
        <div>${escapeHtml(f.filename)}${sizeNote ? ` · ${sizeNote}` : ""}</div>
      </div>
    `;
    item.addEventListener("click", () =>
      openLightbox({
        src: fileUrl,
        platform,
        filename: f.filename,
        fileUrl,
        isSnapshot,
      })
    );
    gallery.appendChild(item);
  }

  for (const f of failedFiles) {
    const item = document.createElement("div");
    item.className = "gallery-item failed-card";
    item.innerHTML = `
      <div>✕ Failed</div>
      <div style="margin-top:6px;font-size:0.7rem;color:var(--muted)">${escapeHtml(f.failure_reason || "Unknown error")}</div>
    `;
    gallery.appendChild(item);
  }
}

function renderJob(job) {
  $("#welcomeView").classList.add("hidden");
  $("#jobView").classList.remove("hidden");

  $("#jobTitle").textContent = `"${job.query}"`;
  const platformLabel = job.auto_mode
    ? "Auto (all platforms)"
    : (job.sources || []).join(", ") || "bing, duckduckgo";
  const routeLabel = job.proxy_mode ? "Webshare proxy" : "local IP";
  const modeNote = job.snapshot_mode
    ? "Page snapshots"
    : job.review_mode
      ? "Review mode"
      : `${job.parallel_downloads || 1} parallel`;
  const sep = `<span class="job-meta-sep">·</span>`;
  $("#jobMeta").innerHTML = [
    statusBadge(job.status),
    escapeHtml(platformLabel),
    escapeHtml(routeLabel),
    escapeHtml(modeNote),
    `Started ${formatTime(job.started_at || job.created_at)}`,
  ].join(sep);

  const hasReview = job.review_mode && (job.candidates?.length > 0);
  $("#reviewTab")?.classList.toggle("hidden", !hasReview);
  if (hasReview) renderReviewGrid(job);
  if (job.status === "awaiting_review") switchTab("review");
  else if (!hasReview || job.status === "completed") {
    /* keep current tab unless first load */
  }

  const isActive = job.status === "running" || job.status === "pending";
  stopBtn.classList.toggle("hidden", !isActive);
  stopBtn.disabled = false;
  stopBtn.textContent = "Stop task";

  $("#statRequested").textContent = job.requested_count;
  $("#statFound").textContent = job.found_count ?? 0;
  $("#statSuccess").textContent = job.success_count ?? 0;
  $("#statFailed").textContent = job.failed_count ?? 0;

  const banner = $("#failureBanner");
  if (job.failure_reason) {
    banner.textContent = job.failure_reason;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  $("#logPanel").innerHTML = "";
  for (const log of job.logs) appendLog(log);
  renderGallery(job);
}

async function loadHistory() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();
  const list = $("#historyList");

  if (!jobs.length) {
    list.innerHTML = `<div class="empty" style="padding:24px"><div class="empty-icon">📂</div>No downloads yet</div>`;
    return;
  }

  list.innerHTML = jobs
    .map(
      (j) => `
    <div class="history-item ${j.id === activeJobId ? "active" : ""}" data-id="${j.id}">
      <div class="q">${escapeHtml(j.query)}</div>
      <div class="meta">
        ${statusBadge(j.status)}
        · ${j.review_mode && j.status === "awaiting_review" ? `${j.found_count ?? 0} URLs` : `${j.success_count}/${j.requested_count} ${j.snapshot_mode ? "snapshots" : "saved"}`}
        · ${formatTime(j.created_at)}
      </div>
    </div>
  `
    )
    .join("");

  $$(".history-item").forEach((el) => {
    el.addEventListener("click", () => {
      selectJob(el.dataset.id);
      closeHistoryPanel();
    });
  });
}

async function selectJob(id) {
  activeJobId = id;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const res = await fetch(`/api/jobs/${id}`);
  const job = await res.json();
  renderJob(job);
  await loadHistory();

  if (job.status === "running" || job.status === "pending" || job.status === "awaiting_review") {
    if (job.status !== "awaiting_review") connectStream(id);
  }
}

function connectStream(id) {
  eventSource = new EventSource(`/api/jobs/${id}/stream`);

  eventSource.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === "log" && data.log) appendLog(data.log);
    if (data.type === "progress") {
      if (data.found_count != null) $("#statFound").textContent = data.found_count;
      if (data.success_count != null) {
        $("#statSuccess").textContent = data.success_count;
        $("#statFailed").textContent = data.failed_count;
      }
    }
    if (data.type === "file" || data.type === "candidates" || data.type === "candidate") {
      fetch(`/api/jobs/${id}`).then((r) => r.json()).then(renderJob);
    }
    if (data.type === "done") {
      eventSource.close();
      eventSource = null;
      selectJob(id);
      loadHistory();
    }
  };
}

stopBtn.addEventListener("click", async () => {
  if (!activeJobId) return;
  stopBtn.disabled = true;
  stopBtn.textContent = "Stopping…";
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/cancel`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.reason || data.error || "Could not stop task");
      stopBtn.disabled = false;
      stopBtn.textContent = "Stop task";
    }
  } catch (err) {
    alert("Could not reach server: " + err.message);
    stopBtn.disabled = false;
    stopBtn.textContent = "Stop task";
  }
});

$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("#query").value.trim();
  const count = Number(countSlider.value);
  const autoMode = autoModeToggle.checked;
  const proxyMode = routeMode === "proxy";
  const snapshotMode = Boolean(snapshotModeToggle?.checked);
  const reviewMode = downloadMode === "review" && !snapshotMode;
  const parallelDownloads = Number(parallelSlider?.value ?? 3);
  const sources = getSelectedSources();

  if (!autoMode && !sources.length) {
    alert("Select at least one platform, or turn on Auto mode.");
    return;
  }

  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, count, autoMode, proxyMode, parallelDownloads, snapshotMode, reviewMode, sources }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.reason || data.error || "Failed to start job");
      return;
    }

    activeJobId = data.id;
    renderJob(data);
    connectStream(data.id);
    await loadHistory();
  } catch (err) {
    alert("Could not reach server: " + err.message);
  }
});

checkHealth();
loadHistory();
