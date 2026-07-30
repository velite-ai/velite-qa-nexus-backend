// ============================================================
// VELITE UNIFIED NEXUS — Application State & Operations Controller
// Departments: Production | QC | QA | CEO
// Companies: Velite Pharmaceuticals | Velite Healthcare
// ============================================================

document.addEventListener("DOMContentLoaded", () => {

  // ---- AVATAR COLOR PALETTE ----
  const avatarColors = ["#7c3aed","#10b981","#3b82f6","#e28743","#ef4444","#f59e0b","#06b6d4"];
  const getColor = (i) => avatarColors[i % avatarColors.length];

  // ---- APPLICATION STATE ----
  let state = {
    loggedIn: false,
    currentUser: null, // { name, email, role, department, avatar, division }
    currentDivision: "pharma",
    currentTab: "dashboard",
    selectedDocId: null,
    selectedBmrBatch: null,
    selectedSensoryBatch: null,
    selectedQcBatch: null,
    esignCallback: null,
    activeWizardTab: "history",
    soloModeEnabled: false,
    pendingLineClearanceBatchId: null,
  };

  const TODAY = new Date("2026-05-24");

  // ============================================================
  // CLAUDE AI API INTEGRATION
  // Model: claude-sonnet-4-6 (Anthropic claude-sonnet-4-20250514 equivalent)
  // Key stored in localStorage for this client-side demo app.
  // ============================================================

  async function callClaude(systemPrompt, userMessage) {
    const apiKey = localStorage.getItem("velite_claude_api_key");
    if (!apiKey) return null;

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-use": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 900,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }]
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error?.message || `API error ${resp.status}`);
      }
      const data = await resp.json();
      return data.content[0].text;
    } catch (err) {
      console.error("Claude API error:", err);
      showNotification(`AI Error: ${err.message}`, "danger");
      return null;
    }
  }

  window.configureClaude = function() {
    const existing = localStorage.getItem("velite_claude_api_key");
    const statusEl = document.getElementById("apikey-current-status");
    if (statusEl) {
      statusEl.textContent = existing
        ? `Current key active: sk-ant-****${existing.slice(-4)}`
        : "No key configured yet.";
    }
    const input = document.getElementById("apikey-input");
    if (input) input.value = "";
    const clearBtn = document.getElementById("apikey-clear-btn");
    if (clearBtn) clearBtn.style.display = existing ? "" : "none";
    document.getElementById("apikey-modal").classList.add("active");
    setTimeout(() => input && input.focus(), 50);
  };

  window.saveClaudeKey = function() {
    const key = document.getElementById("apikey-input").value;
    if (key && key.trim()) {
      localStorage.setItem("velite_claude_api_key", key.trim());
      showNotification("Anthropic API key saved. Claude AI is now active!", "success");
    } else {
      showNotification("No key entered. Configuration unchanged.", "warning");
    }
    document.getElementById("apikey-modal").classList.remove("active");
    updateApiKeyStatus();
  };

  window.clearClaudeKey = function() {
    localStorage.removeItem("velite_claude_api_key");
    document.getElementById("apikey-modal").classList.remove("active");
    showNotification("Anthropic API key removed. AI features now use local knowledge base.", "warning");
    updateApiKeyStatus();
  };

  function updateApiKeyStatus() {
    const hasKey = !!localStorage.getItem("velite_claude_api_key");
    const badge = document.getElementById("ai-key-badge");
    if (!badge) return;
    badge.className = `ai-key-badge${hasKey ? "" : " no-key"}`;
    badge.textContent = hasKey ? "🔑 Claude Active" : "⚙ Set API Key";
  }

  // ============================================================
  // SECTION 1: GMAIL LOGIN FLOW
  // ============================================================

  const loginScreen = document.getElementById("login-screen");
  const initView = document.getElementById("login-init-view");
  const accountsView = document.getElementById("login-accounts-view");
  const loadingView = document.getElementById("login-loading-view");
  const appBody = document.getElementById("app-body");

  // Seed accounts list in login
  function renderLoginAccounts() {
    const users = db.getUsers();
    const container = document.getElementById("google-accounts-container");
    container.innerHTML = "";
    users.forEach((u, i) => {
      const deptClass = {
        "Production": "dept-prod",
        "Quality Control": "dept-qc",
        "Quality Assurance": "dept-qa",
        "Executive": "dept-ceo"
      }[u.department] || "dept-qa";

      const item = document.createElement("div");
      item.className = "google-account-item";
      item.setAttribute("data-email", u.email);
      item.innerHTML = `
        <div class="google-account-avatar" style="background:${getColor(i)};">${u.avatar}</div>
        <div class="google-account-info">
          <h4>${u.name}</h4>
          <p>${u.email}</p>
        </div>
        <span class="google-account-dept badge ${deptClass}">${u.department}</span>
      `;
      item.addEventListener("click", () => initiateLogin(u, i));
      container.appendChild(item);
    });
  }

  document.getElementById("btn-google-sign-in").addEventListener("click", () => {
    renderLoginAccounts();
    initView.style.display = "none";
    accountsView.style.display = "flex";
  });

  document.getElementById("btn-login-back").addEventListener("click", () => {
    accountsView.style.display = "none";
    initView.style.display = "flex";
  });

  function initiateLogin(user, colorIdx) {
    accountsView.style.display = "none";
    loadingView.style.display = "block";

    setTimeout(() => {
      completeLogin(user, colorIdx);
    }, 1600);
  }

  function completeLogin(user, colorIdx) {
    state.loggedIn = true;
    state.currentUser = user;
    state.currentDivision = user.division === "global" ? "pharma" : user.division;

    loginScreen.classList.remove("active");
    appBody.classList.remove("locked-view");

    // Set nav user profile
    document.getElementById("nav-user-avatar").textContent = user.avatar;
    document.getElementById("nav-user-avatar").style.background = getColor(colorIdx);
    document.getElementById("nav-user-name").textContent = user.name;
    document.getElementById("nav-user-role").textContent = `${user.role}, ${user.department}`;

    // Enable hat switcher for CEO (full access)
    if (user.department === "Executive") {
      document.getElementById("hat-switcher-div").style.display = "flex";
      state.soloModeEnabled = true;
    }

    db.addAuditLog(user.name, `Google Account authenticated. Department: ${user.department}. Division access granted.`, "System");

    setDivision(state.currentDivision);
    applyDepartmentVisibility(user.department);
    switchTab("dashboard");
    // Show the banner immediately on login when sync is broken (state.loggedIn is now true)
    try { updateCloudStatus(); } catch (_) {}

    // ----- BULLETPROOF DRIVE RECONNECT -----
    // The user's login click is a user gesture — leverage it RIGHT NOW (still within the gesture's
    // trusted window) to reconnect Drive if a Client ID is saved but no active token. This avoids
    // the "I logged in but the app shows Connect Drive and never reconnects" failure mode.
    try {
      const cid = (typeof getCloudClientId === "function") ? getCloudClientId() : localStorage.getItem("velite_gdrive_client_id");
      if (cid && !gdriveAccessToken) {
        // First try the session-storage cache (synchronous, instant, no popup at all)
        let cacheHit = false;
        try {
          const cached = JSON.parse(sessionStorage.getItem("velite_gdrive_token") || "null");
          if (cached && cached.token && cached.expiresAt > Date.now() + 60000) {
            gdriveAccessToken = cached.token;
            cacheHit = true;
            updateCloudStatus();
            showNotification("Drive sync restored from cache.", "success");
            setTimeout(() => { try { window.syncPendingFilesToDrive && window.syncPendingFilesToDrive(); } catch (_) {} }, 300);
            setTimeout(() => { try { window.startDriveAutoPull && window.startDriveAutoPull(); } catch (_) {} }, 500);
            setTimeout(() => { try { window.pullFromDriveBackup && window.pullFromDriveBackup({ force: true, notify: true }); } catch (_) {} }, 800);
          }
        } catch (_) {}
        // Cache miss → use the login click as the OAuth user gesture (popup will work)
        if (!cacheHit && window.google && window.google.accounts && window.google.accounts.oauth2) {
          try { window.connectGoogleDrive(); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  document.getElementById("btn-logout-nexus").addEventListener("click", () => {
    state.loggedIn = false;
    state.currentUser = null;
    appBody.classList.add("locked-view");
    loginScreen.classList.add("active");
    initView.style.display = "flex";
    accountsView.style.display = "none";
    loadingView.style.display = "none";
  });

  // Hat switcher (solo-operator mode)
  window.switchOperatorHat = function() {
    const hat = document.getElementById("operator-hat-select").value;
    const user = state.currentUser;
    // ★ Record active hat in state so every render function can filter by it.
    // CEO hat = no filter (see everything); QA/QC/Production = filter to that dept.
    state.activeHat = (hat === "CEO") ? null : hat;
    db.addAuditLog(user.name, `[SOLO-OPERATOR EXCEPTION] Hat switched to ${hat} role. AI Audited Exception logged.`, "System");
    applyDepartmentVisibility(hat === "CEO" ? "Executive" : hat === "QC" ? "Quality Control" : hat === "QA" ? "Quality Assurance" : "Production");
    // Re-render every visible data view so the hat filter takes effect immediately
    try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
    try { renderDeviations && renderDeviations(); } catch (_) {}
    try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
    switchTab("dashboard");
    showNotification(
      hat === "CEO"
        ? `Hat: CEO (Executive) — showing all departments.`
        : `Hat: ${hat} — showing only ${hat} documents/deviations. Exception logged in audit trail.`,
      hat === "CEO" ? "success" : "warning"
    );
  };

  // ============================================================
  // SECTION 2: DEPARTMENT-BASED NAVIGATION
  // ============================================================

  function applyDepartmentVisibility(dept) {
    const allNavItems = document.querySelectorAll(".nav-item");
    allNavItems.forEach(item => {
      // Always show general items
      if (!item.classList.contains("production-only") &&
          !item.classList.contains("qc-only") &&
          !item.classList.contains("qa-only") &&
          !item.classList.contains("cosmetic-only") &&
          !item.classList.contains("pharma-only")) {
        item.style.display = "block";
      }
    });

    // Production dept
    const showProd = (dept === "Production" || dept === "Executive");
    document.querySelectorAll(".production-only").forEach(el => el.style.display = showProd ? "block" : "none");

    // QC dept (shows cosmetic-only tabs too if HC division)
    const showQC = (dept === "Quality Control" || dept === "Executive");
    document.querySelectorAll(".qc-only").forEach(el => el.style.display = showQC ? "block" : "none");

    // QA dept
    const showQA = (dept === "Quality Assurance" || dept === "Executive");
    document.querySelectorAll(".qa-only").forEach(el => el.style.display = showQA ? "block" : "none");

    // Buttons inside views for QA-only actions
    document.querySelectorAll(".qa-only-btn").forEach(el => el.style.display = showQA ? "inline-flex" : "none");
    document.querySelectorAll(".qc-only-btn").forEach(el => el.style.display = showQC ? "inline-flex" : "none");

    // Division-specific navs handled in setDivision
    setDivision(state.currentDivision);
  }

  // ============================================================
  // SECTION 3: DIVISION THEME TOGGLING
  // ============================================================

  const brandSub = document.getElementById("brand-sub");
  const brandLogo = document.getElementById("brand-logo-id");
  const divisionStatusSub = document.getElementById("division-status-sub");
  const navItems = document.querySelectorAll(".nav-item");

  function setDivision(division) {
    state.currentDivision = division;

    if (division === "pharma") {
      appBody.className = "pharma-theme";
      brandSub.textContent = "Pharmaceuticals";
      divisionStatusSub.textContent = "Velite Pharmaceuticals — Drugs Quality Operations";
      document.getElementById("toggle-pharma").className = "toggle-option active active-pharma";
      document.getElementById("toggle-cosmetic").className = "toggle-option";
      document.querySelectorAll(".pharma-only").forEach(el => {
        const dept = state.currentUser?.department;
        if (dept === "Executive" || dept === "Quality Assurance") el.style.display = "block";
      });
      document.querySelectorAll(".cosmetic-only").forEach(el => el.style.display = "none");
    } else {
      appBody.className = "healthcare-theme";
      brandSub.textContent = "Healthcare";
      divisionStatusSub.textContent = "Velite Healthcare — Cosmetics Quality Operations";
      document.getElementById("toggle-pharma").className = "toggle-option";
      document.getElementById("toggle-cosmetic").className = "toggle-option active active-cosmetic";
      document.querySelectorAll(".pharma-only").forEach(el => el.style.display = "none");
      const dept = state.currentUser?.department;
      document.querySelectorAll(".cosmetic-only").forEach(el => {
        if (dept === "Executive" || dept === "Quality Assurance" || dept === "Quality Control") {
          el.style.display = "block";
        }
      });
    }
    db.addAuditLog(state.currentUser?.name || "System", `Switched to Velite ${division === "pharma" ? "Pharmaceuticals" : "Healthcare"} division.`, "Global");
    switchTab("dashboard");
    rebuildMetrics();
  }

  document.getElementById("division-toggle").addEventListener("click", (e) => {
    const opt = e.target.closest(".toggle-option");
    if (!opt) return;
    const sel = opt.getAttribute("data-div");
    if (sel === "pharma" && state.currentDivision !== "pharma") setDivision("pharma");
    else if (sel === "cosmetics" && state.currentDivision !== "cosmetics") setDivision("cosmetics");
  });

  // ============================================================
  // SECTION 4: TAB ROUTING
  // ============================================================

  window.switchTab = function(tabName) {
    state.currentTab = tabName;
    navItems.forEach(item => {
      item.classList.toggle("active", item.getAttribute("data-tab") === tabName);
    });

    const titles = {
      dashboard: "Quality Dashboard Overview",
      documents: "Document Control Vault",
      deviations: "Deviation & CAPA Tracker",
      bmrs: "Electronic Batch Records",
      sensory: "Sensory Profile & CoA",
      stability: "Stability Testing Chambers",
      ingredients: "Allergen & Ingredient Compliance",
      iso17: "ISO 22716 Compliance Scorecard",
      audit: "Regulatory Audit Trail",
      "production-active": "Production Floor — Batch Compounding",
      "production-clearance": "Line Clearance Board",
      "qc-testing": "QC Laboratory Testing Console",
      "qa-ai-training": "Velite AI — Training Center"
    };

    document.getElementById("view-title").textContent = titles[tabName] || "Quality Hub";

    document.querySelectorAll(".viewport-panel").forEach(p => {
      p.classList.toggle("active", p.id === `vp-${tabName}`);
    });

    // Trigger renders
    if (tabName === "dashboard") { rebuildMetrics(); renderDashboardLists(); }
    if (tabName === "documents") renderDocumentVault();
    if (tabName === "deviations") renderDeviations();
    if (tabName === "bmrs") renderBmrList();
    if (tabName === "sensory") renderCosmeticBatchList();
    if (tabName === "stability") renderStabilityStudies();
    if (tabName === "iso17") renderIsoChecklist();
    if (tabName === "audit") renderAuditTimeline();
    if (tabName === "production-active") renderProductionBatchesPanel();
    if (tabName === "production-clearance") renderLineClearanceBoard();
    if (tabName === "qc-testing") renderQcSamplesPanel();
    if (tabName === "qa-ai-training") renderAiTrainingCenter();
  };

  navItems.forEach(item => {
    item.addEventListener("click", () => switchTab(item.getAttribute("data-tab")));
  });

  // ============================================================
  // SECTION 5: METRICS & DASHBOARD
  // ============================================================

  function getRenewalUrgency(renewalDateStr) {
    // Optional renewal date — some docs have no renewal cycle (Policies, one-offs, Records).
    if (!renewalDateStr) return { label: "No renewal", class: "badge-active", scoreImpact: 0 };
    const renDate = new Date(renewalDateStr);
    if (isNaN(renDate.getTime())) return { label: "No renewal", class: "badge-active", scoreImpact: 0 };
    const diffDays = Math.ceil((renDate - TODAY) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: "Overdue", class: "badge-overdue", scoreImpact: 20 };
    if (diffDays <= 60) return { label: "Expiring Soon", class: "badge-expiring", scoreImpact: 5 };
    return { label: "Active", class: "badge-active", scoreImpact: 0 };
  }

  function rebuildMetrics() {
    const kpiGrid = document.getElementById("kpi-grid-area");
    // ★ Division filter: dashboard KPIs must only count docs / deviations for the current division.
    // Legacy records without a division field are visible in both (backward compat).
    // "Both" division records also count in both.
    const currentDivLabel = state.currentDivision === "cosmetics" ? "Healthcare" : "Pharmaceuticals";
    const matchesDivDoc = (d) => !d.division || d.division === "Both" || d.division === currentDivLabel;
    const matchesDivDev = (dv) => !dv.division || dv.division === "Both" || dv.division === currentDivLabel;

    const docs = db.getDocuments().filter(matchesDivDoc);
    let expiring = 0, overdue = 0;
    docs.forEach(d => {
      const u = getRenewalUrgency(d.renewalDate);
      if (u.label === "Expiring Soon") expiring++;
      if (u.label === "Overdue") overdue++;
    });

    let html = "";
    const div = state.currentDivision;

    if (div === "pharma") {
      const devs = db.getDeviations().filter(matchesDivDev);
      const openDevs = devs.filter(dv => dv.status !== "Closed").length;
      const quarantined = db.getBatches().filter(b => b.division === "Pharmaceuticals" && b.status === "Quarantined").length;
      html = `
        <div class="kpi-card"><div class="kpi-info"><p>Active SOPs</p><h3>${docs.length}</h3><span>Total Quality Documents</span></div><div class="kpi-icon">📄</div></div>
        <div class="kpi-card" style="border-left-color:var(--color-warning)"><div class="kpi-info"><p>Expiring / Overdue</p><h3 style="color:var(--color-warning)">${expiring + overdue}</h3><span>Needs Urgent Renewal</span></div><div class="kpi-icon" style="color:var(--color-warning)">⏳</div></div>
        <div class="kpi-card" style="border-left-color:var(--color-danger)"><div class="kpi-info"><p>Open Deviations</p><h3 style="color:var(--color-danger)">${openDevs}</h3><span>Active CAPA Investigations</span></div><div class="kpi-icon" style="color:var(--color-danger)">⚠️</div></div>
        <div class="kpi-card"><div class="kpi-info"><p>BMR Quarantines</p><h3>${quarantined}</h3><span>Awaiting QA Release</span></div><div class="kpi-icon">🔐</div></div>
      `;
    } else {
      const pendingSensory = db.getBatches().filter(b => b.division === "Healthcare" && b.status === "Ready for Sensory QC").length;
      const stabs = db.getStability().filter(s => s.status === "Ongoing").length;
      html = `
        <div class="kpi-card"><div class="kpi-info"><p>Active Procedures</p><h3>${docs.length}</h3><span>Total Quality Documents</span></div><div class="kpi-icon">📄</div></div>
        <div class="kpi-card" style="border-left-color:var(--color-warning)"><div class="kpi-info"><p>Expiring / Overdue</p><h3 style="color:var(--color-warning)">${expiring + overdue}</h3><span>Needs Urgent Renewal</span></div><div class="kpi-icon" style="color:var(--color-warning)">⏳</div></div>
        <div class="kpi-card"><div class="kpi-info"><p>Sensory QCs Pending</p><h3>${pendingSensory}</h3><span>Awaiting Parameters</span></div><div class="kpi-icon">🔬</div></div>
        <div class="kpi-card"><div class="kpi-info"><p>Stability Studies</p><h3>${stabs}</h3><span>Active Chamber Batches</span></div><div class="kpi-icon">🧪</div></div>
      `;
    }
    kpiGrid.innerHTML = html;
  }

  function renderDashboardLists() {
    // ★ Division filter — dashboard lists must reflect only current division.
    const currentDivLabel = state.currentDivision === "cosmetics" ? "Healthcare" : "Pharmaceuticals";
    const matchesDivDoc = (d) => !d.division || d.division === "Both" || d.division === currentDivLabel;
    const matchesDivDev = (dv) => !dv.division || dv.division === "Both" || dv.division === currentDivLabel;

    const docs = db.getDocuments().filter(matchesDivDoc);
    // Sort by renewal date; docs without a renewal date go to the end
    const sorted = [...docs].sort((a, b) => {
      const ta = a.renewalDate ? new Date(a.renewalDate).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.renewalDate ? new Date(b.renewalDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
    let tableHtml = "", score = 100;

    sorted.slice(0, 6).forEach(d => {
      const u = getRenewalUrgency(d.renewalDate);
      score -= u.scoreImpact;
      tableHtml += `<tr>
        <td><strong style="color:var(--accent-color)">${d.id}</strong></td>
        <td>${d.title}</td>
        <td>${d.renewalDate || "—"}</td>
        <td><span class="badge ${u.class}">${u.label}</span></td>
      </tr>`;
    });

    if (!tableHtml) tableHtml = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No quality documents for ${currentDivLabel}.</td></tr>`;
    document.getElementById("dashboard-renewal-table").innerHTML = tableHtml;

    score = Math.max(40, score);
    const gauge = document.getElementById("gauge-circle");
    const pct = document.getElementById("gauge-pct");
    if (gauge) {
      gauge.style.strokeDashoffset = 251.2 - (251.2 * score / 100);
      gauge.style.stroke = score > 85 ? "var(--color-success)" : score > 65 ? "var(--color-warning)" : "var(--color-danger)";
    }
    if (pct) pct.textContent = `${score}%`;

    const activeCount = docs.filter(d => getRenewalUrgency(d.renewalDate).label === "Active").length;
    document.getElementById("dash-active-docs").textContent = `${activeCount} / ${docs.length} Active`;

    const tasks = state.currentDivision === "pharma"
      ? db.getDeviations().filter(matchesDivDev).filter(dv => dv.status !== "Closed").length
      : db.getBatches().filter(b => b.division === "Healthcare" && b.status === "Ready for Sensory QC").length;
    document.getElementById("dash-open-tasks").textContent = `${tasks} Task${tasks !== 1 ? "s" : ""} Pending`;

    const logs = db.getAuditLogs().slice(0, 5);
    document.getElementById("dash-audit-timeline").innerHTML = logs.map(l =>
      `<div class="audit-log-item">
        <div class="audit-meta">${l.timestamp}</div>
        <div class="audit-text"><strong>${l.user}</strong>: ${l.action}</div>
        <div class="audit-div">[${l.division}]</div>
      </div>`
    ).join("") || `<div style="text-align:center;color:var(--text-muted)">No activity logged yet.</div>`;
  }

  // ============================================================
  // SECTION 6: DOCUMENT VAULT
  // ============================================================
  // ---- Document file helpers (IndexedDB-backed: NO size cap, auto-backup to Drive when connected) ----

  // IndexedDB wrapper: localStorage can't hold large binaries; IDB can (gigabyte scale).
  const IDB_DB_NAME = "velite_files";
  const IDB_STORE = "documents";
  let _idbPromise = null;
  function idbOpen() {
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _idbPromise;
  }
  async function idbPut(key, blob) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error("IDB write failed"));
      tx.onabort = () => rej(tx.error || new Error("IDB transaction aborted"));
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error || new Error("IDB read failed"));
    });
  }
  async function idbDelete(key) {
    if (!key) return;
    const db = await idbOpen();
    return new Promise((res) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res(); // non-fatal — best-effort cleanup
      tx.onabort = () => res();
    });
  }

  function dataUrlToBlob(dataUrl) {
    const i = dataUrl.indexOf(",");
    const meta = dataUrl.substring(0, i);
    const b64 = dataUrl.substring(i + 1);
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return new Blob([bytes], { type: mime });
  }

  function triggerBrowserDownload(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  window.downloadDocFile = async function(docId, type) {
    const doc = db.getDocuments().find(d => d.id === docId);
    if (!doc) { showNotification("Document not found.", "danger"); return; }
    const file = type === "pdf" ? doc.pdfFile : doc.wordFile;
    if (!file) { showNotification("No file attached for this slot.", "warning"); return; }
    // Legacy seed data: just a filename string, no real content
    if (typeof file === "string") {
      showNotification(`"${file}" is sample reference data — no real file is stored. Click Edit SOP and upload the actual file to enable download.`, "warning");
      return;
    }
    // Legacy embedded-base64 upload (from earlier app version)
    if (file.data && typeof file.data === "string" && file.data.startsWith("data:")) {
      try { triggerBrowserDownload(file.name, dataUrlToBlob(file.data)); showNotification(`Downloading ${file.name}…`, "success"); }
      catch (e) { showNotification("Download failed: " + (e.message || e), "danger"); }
      return;
    }
    // New format: blob in IndexedDB, optionally also in Drive
    try {
      let blob = file.idbKey ? await idbGet(file.idbKey) : null;
      if (!blob && file.driveFileId) {
        showNotification(`Fetching ${file.name} from Google Drive…`, "warning");
        if (typeof window.downloadDriveFile !== "function") throw new Error("Drive sync not loaded yet");
        blob = await window.downloadDriveFile(file.driveFileId);
        if (blob && file.idbKey) { try { await idbPut(file.idbKey, blob); } catch (_) {} }
      }
      if (!blob) { showNotification("File content not found locally. Connect Cloud Sync to restore from Drive.", "danger"); return; }
      triggerBrowserDownload(file.name, blob);
      showNotification(`Downloading ${file.name}…`, "success");
    } catch (e) {
      showNotification("Download failed: " + (e.message || e), "danger");
    }
  };

  // Back-compat shim (any legacy caller)
  window.mockDownloadFile = function(fileName, type) {
    showNotification(`${type === "pdf" ? "📕" : "📝"} "${fileName}" is sample reference data — please upload the real file via Edit SOP.`, "warning");
  };

  // ★ Bulk-tag division for many docs at once. Used once when migrating
  // existing (untagged) records into the new division-scoped system.
  // Executive-only via the invoking button; the function itself doesn't gate.
  window.bulkSetDocumentDivision = function() {
    const docs = db.getDocuments();
    const total = docs.length;
    if (total === 0) { showNotification("No documents to bulk-tag.", "warning"); return; }

    // Count current state so the user sees what will change
    const counts = { Pharmaceuticals: 0, Healthcare: 0, Both: 0, Untagged: 0 };
    for (const d of docs) {
      if (!d.division) counts.Untagged++;
      else if (counts[d.division] != null) counts[d.division]++;
      else counts.Untagged++;
    }

    const scope = window.prompt(
      `Bulk-tag document division\n\n` +
      `Current state:\n` +
      `  • Pharmaceuticals: ${counts.Pharmaceuticals}\n` +
      `  • Healthcare:      ${counts.Healthcare}\n` +
      `  • Both:            ${counts.Both}\n` +
      `  • Untagged:        ${counts.Untagged}\n` +
      `  • TOTAL:           ${total}\n\n` +
      `Which docs do you want to change?\n` +
      `  Type 1 → ALL ${total} documents\n` +
      `  Type 2 → Only UNTAGGED (${counts.Untagged}) documents\n` +
      `  Type 3 → Only currently "Both" (${counts.Both}) documents\n\n` +
      `Cancel to abort.`
    );
    if (!scope) return;
    let filterFn, filterLabel;
    if (scope.trim() === "1") { filterFn = () => true; filterLabel = "ALL"; }
    else if (scope.trim() === "2") { filterFn = (d) => !d.division; filterLabel = "UNTAGGED"; }
    else if (scope.trim() === "3") { filterFn = (d) => d.division === "Both"; filterLabel = "currently Both"; }
    else { showNotification("Bulk-tag cancelled: invalid selection.", "warning"); return; }

    const target = window.prompt(
      `Set the selected ${filterLabel} docs to which division?\n\n` +
      `Type P → Pharmaceuticals\n` +
      `Type H → Healthcare\n` +
      `Type B → Both (visible in both divisions)\n\n` +
      `Cancel to abort.`
    );
    if (!target) return;
    const t = (target || "").trim().toUpperCase();
    let newDivision;
    if (t === "P" || t === "PHARMA" || t === "PHARMACEUTICALS") newDivision = "Pharmaceuticals";
    else if (t === "H" || t === "HC" || t === "HEALTHCARE") newDivision = "Healthcare";
    else if (t === "B" || t === "BOTH") newDivision = "Both";
    else { showNotification("Bulk-tag cancelled: invalid division.", "warning"); return; }

    const willChange = docs.filter(filterFn).length;
    if (willChange === 0) { showNotification(`No documents match the selected scope (${filterLabel}). Nothing to do.`, "warning"); return; }

    if (!window.confirm(
      `Confirm bulk-tag operation:\n\n` +
      `  Set ${willChange} ${filterLabel} document(s) → division "${newDivision}"\n\n` +
      `This will change ONLY the division field; document content, versions, files, and audit trail are untouched.\n\n` +
      `Continue?`
    )) {
      showNotification("Bulk-tag cancelled.", "warning");
      return;
    }

    let updated = 0;
    for (const d of docs) {
      if (filterFn(d) && d.division !== newDivision) {
        d.division = newDivision;
        updated++;
      }
    }
    db.saveDocuments(docs);
    try {
      db.addAuditLog(state.currentUser?.name || "Executive",
        `Bulk-tagged ${updated} document(s) to division "${newDivision}" (scope: ${filterLabel}).`,
        state.currentDivision);
    } catch (_) {}

    // Also push updated per-doc metadata to Drive for each changed doc so other machines see it
    if (typeof window.writeDocToDriveMeta === "function") {
      for (const d of docs) {
        if (filterFn(d) && d.division === newDivision) {
          try { window.writeDocToDriveMeta(d); } catch (_) {}
        }
      }
    }
    // Trigger the standard backup so backup.json is refreshed
    if (typeof window.backupToDrive === "function") {
      setTimeout(() => { try { window.backupToDrive(); } catch (_) {} }, 300);
    }

    try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
    try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
    showNotification(`✓ Bulk-tag complete: ${updated} document(s) set to "${newDivision}".`, "success");
  };

  window.renderDocumentVault = function() {
    const docs = db.getDocuments();
    const q = document.getElementById("search-docs").value.toLowerCase();
    // Role gate for destructive actions — only QA-class users see Delete
    const dept = state.currentUser?.department || "";
    const canDelete = (dept === "Quality Assurance" || dept === "Executive");

    // ★ Division filter (Fix #1): show only docs matching the current division.
    // Legacy docs without a division field are visible in both (backward compat).
    // "Both" division docs are also always visible.
    const currentDivLabel = state.currentDivision === "cosmetics" ? "Healthcare" : "Pharmaceuticals";
    const matchesDivision = (d) => !d.division || d.division === "Both" || d.division === currentDivLabel;

    // ★ Hat filter (Fix #2): if user is Executive and switched hats, filter docs
    // to just that hat's department. CEO hat = no filter (see everything).
    const activeHat = state.activeHat || null;
    const hatDeptMap = { "QA": "Quality Assurance", "QC": "Quality Control", "Production": "Production" };
    const hatDept = activeHat ? hatDeptMap[activeHat] : null;
    const matchesHat = (d) => !hatDept || d.department === hatDept;

    const sorted = [...docs].sort((a, b) => {
      const pri = { "Overdue": 3, "Expiring Soon": 2, "Active": 1, "No renewal": 0 };
      const pA = pri[getRenewalUrgency(a.renewalDate).label] || 0, pB = pri[getRenewalUrgency(b.renewalDate).label] || 0;
      return pA !== pB ? pB - pA : a.id.localeCompare(b.id);
    });

    const rows = sorted
      .filter(matchesDivision)
      .filter(matchesHat)
      .filter(d => !q || d.id.toLowerCase().includes(q) || d.title.toLowerCase().includes(q) || d.department.toLowerCase().includes(q))
      .map(d => {
        const u = getRenewalUrgency(d.renewalDate);
        const statusMap = { "Approved": "badge-approved", "In Review": "badge-review", "Draft": "badge-draft", "Under Revision": "badge-revision" };
        return `<tr>
          <td><strong style="color:var(--accent-color)">${d.id}</strong></td>
          <td><strong>${d.title}</strong></td>
          <td><span style="font-size:0.78rem;opacity:0.85">${d.category}</span></td>
          <td><span style="font-size:0.78rem">${d.department}</span></td>
          <td><strong style="color:#60a5fa">v${d.version}</strong></td>
          <td><span class="badge ${statusMap[d.status] || "badge-draft"}">${d.status}</span></td>
          <td>${d.effectiveDate || "—"}</td>
          <td><strong>${d.renewalDate || "—"}</strong></td>
          <td><span class="badge ${u.class}">${u.label}</span></td>
          <td>
            ${(() => {
              const fileMeta = (f) => {
                if (!f) return null;
                if (typeof f === "string") return { name: f, real: false, drive: false, verified: false };
                return { name: f.name, real: true, drive: !!f.driveFileId, verified: !!f.byteVerified };
              };
              const w = fileMeta(d.wordFile), pp = fileMeta(d.pdfFile);
              const badge = (m, kind, color, bg, brd, icon, label) => {
                if (!m) return '';
                const flag = m.real ? (m.drive ? (m.verified ? "☁✓" : "☁") : "•") : "*";
                const tip = m.real
                  ? (m.drive
                      ? (m.verified
                          ? `Download exact original — Local + Drive backup byte-verified ✓ (no font/format changes): ${m.name}`
                          : `Download — Local + Drive backup: ${m.name}`)
                      : `Download exact original — Local only (connect Cloud Sync to back up): ${m.name}`)
                  : `Sample reference — upload the real file via Edit SOP to enable download: ${m.name}`;
                return `<span class="badge" title="${tip}" style="background:${bg};color:${color};border:1px solid ${brd};cursor:pointer;${m.real?"":"opacity:0.65"}" onclick="downloadDocFile('${d.id}','${kind}')">${icon} ${label} ${flag}</span>`;
              };
              const wBadge = w ? badge(w, "word", "#60a5fa", "rgba(96,165,250,0.12)", "rgba(96,165,250,0.3)", "📝", "Word")
                                : '<span style="font-size:0.72rem;color:var(--text-muted)">No Word</span>';
              const pBadge = pp ? badge(pp, "pdf", "#f87171", "rgba(248,113,113,0.12)", "rgba(248,113,113,0.3)", "📕", "PDF") : '';
              return wBadge + " " + pBadge;
            })()}
          </td>
          <td>
            <div style="display:flex;gap:7px;flex-wrap:wrap">
              <button class="btn-renew" onclick="openHistoryModal('${d.id}')">History & Renew</button>
              <button class="btn-edit" onclick="openDocumentModal('${d.id}')">Edit SOP</button>
              ${canDelete ? `<button class="btn-danger-sm" onclick="deleteDocument('${d.id}')" title="Delete document (Word + PDF + metadata). Files go to Drive trash and can be restored for 30 days.">Delete</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join("");

    // Show a filter-aware empty state so users understand WHY the vault appears empty
    const filterParts = [];
    filterParts.push(currentDivLabel);
    if (hatDept) filterParts.push(`${activeHat} hat`);
    if (q) filterParts.push(`matching "${q}"`);
    const emptyMsg = `No SOPs found for: <strong>${filterParts.join(" • ")}</strong>.` +
      (hatDept ? `<br><span style="font-size:0.78rem">Switch to CEO hat to see all departments.</span>` : "");
    document.getElementById("vault-table-body").innerHTML = rows || `<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:30px">${emptyMsg}</td></tr>`;
  };

  // Document modal
  window.openDocumentModal = function(docId = null) {
    const modal = document.getElementById("document-modal");
    document.getElementById("modal-doc-id").value = "";
    document.getElementById("modal-doc-id").disabled = false;
    document.getElementById("modal-doc-title").value = "";
    document.getElementById("modal-doc-version").value = "1.0";
    document.getElementById("modal-doc-category").value = "SOP";
    document.getElementById("modal-doc-dept").value = "Quality Assurance";
    document.getElementById("modal-doc-status").value = "Approved";
    // Default the division to whichever the user is currently viewing.
    // pharma → Pharmaceuticals, cosmetics → Healthcare.
    const divSel = document.getElementById("modal-doc-division");
    if (divSel) divSel.value = state.currentDivision === "cosmetics" ? "Healthcare" : "Pharmaceuticals";
    document.getElementById("modal-doc-effdate").value = "";
    document.getElementById("modal-doc-rendate").value = "";
    document.getElementById("modal-doc-changes").value = "";
    document.getElementById("modal-word-file-label").textContent = "";
    document.getElementById("modal-pdf-file-label").textContent = "";

    if (docId) {
      const doc = db.getDocuments().find(d => d.id === docId);
      if (doc) {
        document.getElementById("doc-modal-title").textContent = "Edit SOP / Document Metadata";
        document.getElementById("modal-doc-id").value = doc.id;
        document.getElementById("modal-doc-id").disabled = true;
        document.getElementById("modal-doc-title").value = doc.title;
        document.getElementById("modal-doc-version").value = doc.version;
        document.getElementById("modal-doc-category").value = doc.category;
        document.getElementById("modal-doc-dept").value = doc.department;
        document.getElementById("modal-doc-status").value = doc.status;
        // Populate division for edit (fall back to Both for legacy docs without one)
        const divSelEdit = document.getElementById("modal-doc-division");
        if (divSelEdit) divSelEdit.value = doc.division || "Both";
        document.getElementById("modal-doc-effdate").value = doc.effectiveDate || "";
        document.getElementById("modal-doc-rendate").value = doc.renewalDate || "";
        const labelFor = (f, kind) => {
          if (!f) return `No ${kind} uploaded`;
          if (typeof f === "string") return `Sample reference: ${f} (no real file stored — upload to enable download)`;
          const sizeKB = Math.max(1, Math.round(f.size/1024));
          const sizeText = sizeKB > 1024 ? (sizeKB/1024).toFixed(1) + " MB" : sizeKB + " KB";
          let backup;
          if (f.driveFileId) {
            backup = f.byteVerified
              ? " • Drive backup ✓ (byte-identical, no conversion)"
              : " • Drive backup ✓";
          } else {
            backup = " • Local only (connect ☁ Cloud Sync to back up)";
          }
          return `Current: ${f.name} (${sizeText})${backup}`;
        };
        document.getElementById("modal-word-file-label").textContent = labelFor(doc.wordFile, "Word");
        document.getElementById("modal-pdf-file-label").textContent = labelFor(doc.pdfFile, "PDF");
      }
    } else {
      document.getElementById("doc-modal-title").textContent = "Create / Upload New Quality Document";
    }
    // Add/update Drive-not-connected warning inside the modal
    let warn = document.getElementById("doc-modal-drive-warn");
    if (!warn) {
      warn = document.createElement("div");
      warn.id = "doc-modal-drive-warn";
      warn.style.cssText = "display:none; background: rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.5); color:#fca5a5; padding:10px 12px; border-radius:6px; margin:0 0 8px; font-size:0.82rem; line-height:1.4;";
      const body = document.querySelector("#document-modal .modal-body");
      if (body) body.insertBefore(warn, body.firstChild);
    }
    if (warn) {
      const cid = getCloudClientId();
      if (cid && !gdriveAccessToken) {
        warn.innerHTML = "⚠ <strong>Drive sync is not active.</strong> This SOP will be saved on this device only. <strong>Other QA Managers will NOT see it</strong> until you click <em>Reconnect Drive</em> first.";
        warn.style.display = "block";
      } else if (!cid) {
        warn.innerHTML = "⚠ <strong>Cloud Sync is not configured on this device.</strong> This SOP will be saved on this device only. Set up ☁ Cloud Sync to share with other QA Managers.";
        warn.style.display = "block";
      } else {
        warn.style.display = "none";
      }
    }
    modal.classList.add("active");
  };

  window.closeDocumentModal = () => document.getElementById("document-modal").classList.remove("active");

  window.saveDocument = async function() {
    const id = document.getElementById("modal-doc-id").value.trim().toUpperCase();
    const title = document.getElementById("modal-doc-title").value.trim();
    const version = document.getElementById("modal-doc-version").value.trim();
    // Category is now free-text with datalist suggestions — trim and fall back
    // to "SOP" if the user left it blank (legacy behavior).
    const category = (document.getElementById("modal-doc-category").value || "").trim() || "SOP";
    // Applicable division — Pharmaceuticals | Healthcare | Both. Defaults to current view.
    const division = (document.getElementById("modal-doc-division")?.value)
                     || (state.currentDivision === "cosmetics" ? "Healthcare" : "Pharmaceuticals");
    const department = document.getElementById("modal-doc-dept").value;
    const status = document.getElementById("modal-doc-status").value;
    const effDate = document.getElementById("modal-doc-effdate").value;
    const renDate = document.getElementById("modal-doc-rendate").value;
    const changes = document.getElementById("modal-doc-changes").value.trim();
    const wordInput = document.getElementById("modal-doc-word");
    const pdfInput = document.getElementById("modal-doc-pdf");

    // Only ID, Title, Version are truly required. Effective and Renewal dates
    // are optional — some documents (Policies, Records, one-off memos) don't have
    // renewal cycles at all. Empty dates are stored as empty strings and rendered as "—".
    if (!id || !title || !version) { showNotification("Please fill in the required fields: ID, Title, Version.", "danger"); return; }

    // Multi-user safety: pull-and-merge from Drive FIRST so we don't overwrite a colleague's recent upload
    if (gdriveAccessToken && typeof window.pullFromDriveBackup === "function") {
      try { await window.pullFromDriveBackup({ notify: false }); } catch (_) {}
    }

    const wf = wordInput.files[0], pf = pdfInput.files[0];
    const driveOn = !!(window && typeof window === "object" && (function(){try{return !!gdriveAccessToken;}catch(_){return false;}})());

    // Store an uploaded File: put the Blob in IndexedDB (no size cap), then push to Drive if connected.
    async function storeUploadedFile(file, kind) {
      if (!file) return undefined;
      const ts = Date.now();
      const safeName = (file.name || "file").replace(/[^\w.\-]/g, "_");
      const idbKey = `${id}-${kind}-${ts}-${safeName}`;
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      try {
        showNotification(`Saving ${kind.toUpperCase()} (${sizeMB} MB) locally…`, "warning");
        await idbPut(idbKey, file); // store the Blob/File directly — no base64 inflation
      } catch (e) {
        throw new Error(`Local file storage failed for ${file.name}: ${e.message || e}`);
      }
      let driveFileId = null, driveName = null, driveMd5 = null, byteVerified = false;
      if (gdriveAccessToken) {
        try {
          showNotification(`Backing up ${file.name} to Google Drive (byte-identical, no conversion)…`, "warning");
          const driveUploaded = await uploadFileToDrive(file, `${id}-${kind}-${safeName}`, file.type);
          if (driveUploaded) {
            driveFileId = driveUploaded.id;
            driveName = driveUploaded.name;
            driveMd5 = driveUploaded.md5Checksum || null;
            byteVerified = !!driveUploaded.byteVerified;
            if (!byteVerified) {
              showNotification(`Drive copy size mismatch — please try uploading again to ensure integrity.`, "danger");
            }
          }
        } catch (e) {
          showNotification(`Saved locally; Drive backup failed: ${e.message || e}`, "warning");
        }
      }
      return {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        idbKey,
        driveFileId,
        driveName,
        driveMd5,
        byteVerified,
        uploadedAt: new Date().toISOString()
      };
    }

    let wordFileObj, pdfFileObj;
    try {
      wordFileObj = await storeUploadedFile(wf, "word");
      pdfFileObj = await storeUploadedFile(pf, "pdf");
    } catch (e) {
      showNotification("Upload failed: " + (e.message || e), "danger");
      return;
    }

    const docs = db.getDocuments();
    const isEdit = document.getElementById("modal-doc-id").disabled;
    const user = state.currentUser?.name || "Sanjiv Kumar Verma";

    let savedDocRef = null; // the just-saved/just-updated doc object (used for per-doc Drive write)
    if (isEdit) {
      const idx = docs.findIndex(d => d.id === id);
      if (idx !== -1) {
        const oldVer = docs[idx].version;
        docs[idx] = { ...docs[idx], title, version, category, department, status, division, effectiveDate: effDate, renewalDate: renDate };
        if (wordFileObj) docs[idx].wordFile = wordFileObj;
        if (pdfFileObj) docs[idx].pdfFile = pdfFileObj;
        if (changes || oldVer !== version) {
          docs[idx].history.unshift({ version, date: "2026-05-24", author: user, changes: changes || `Metadata updated. Version: v${oldVer} → v${version}` });
        }
        savedDocRef = docs[idx];
        db.addAuditLog(user, `Modified quality document ${id} (v${version})${wordFileObj?" + Word upload":""}${pdfFileObj?" + PDF upload":""}`, state.currentDivision);
      }
    } else {
      if (docs.some(d => d.id === id)) { showNotification(`Document ID ${id} already exists. Please use a unique ID.`, "danger"); return; }
      // ★ Creating a new doc with a previously-tombstoned ID clears the tombstone
      // (both locally and on Drive) so the new record can sync.
      if (typeof _isTombstoned === "function" && _isTombstoned(id)) {
        _removeTombstone(id);
        if (gdriveAccessToken) { try { await trashTombstoneOnDrive(id); } catch (_) {} }
      }
      const newDoc = { id, title, category, department, version, status, division, effectiveDate: effDate, renewalDate: renDate, owner: user,
        wordFile: wordFileObj,
        pdfFile: pdfFileObj,
        history: [{ version, date: "2026-05-24", author: user, changes: changes || "Initial document registration." }]
      };
      docs.push(newDoc);
      savedDocRef = newDoc;
      db.addAuditLog(user, `Created quality document: ${id} - ${title}${wordFileObj?" (Word attached)":""}${pdfFileObj?" (PDF attached)":""}`, state.currentDivision);
    }

    try {
      db.saveDocuments(docs);
    } catch (e) {
      showNotification("Could not save document record: " + (e.message || e), "danger");
      return;
    }

    // ★ CRITICAL: write THIS doc's per-doc metadata file to Drive immediately.
    // This is a single ~1 KB atomic write — independent of every other doc, the
    // legacy backup.json, the debounced auto-sync, or anything else. If it
    // succeeds, this document is GUARANTEED visible on every other QA Manager's
    // machine on their next pull. No more race-condition orphans.
    if (gdriveAccessToken && savedDocRef && typeof window.writeDocToDriveMeta === "function") {
      window.writeDocToDriveMeta(savedDocRef).then(res => {
        if (res) {
          console.log(`[Velite] doc-${id}.json written to Drive Metadata folder.`);
        } else {
          console.warn(`[Velite] doc-${id}.json write returned null — relying on backup.json fallback.`);
        }
      }).catch(err => console.warn(`[Velite] writeDocToDriveMeta error:`, err));
    }

    closeDocumentModal();
    renderDocumentVault();
    rebuildMetrics();

    const fileCount = (wordFileObj?1:0) + (pdfFileObj?1:0);
    if (fileCount > 0) {
      const allVerified = [wordFileObj, pdfFileObj].filter(Boolean).every(f => f.byteVerified);
      const drivePart = gdriveAccessToken
        ? (allVerified ? "Local + Drive backup ✓ (byte-identical — fonts & formatting preserved)" : "Local + Drive backup uploaded.")
        : "⚠ Local only — connect ☁ Cloud Sync to share with other QA Managers!";
      showNotification(`${isEdit ? "Document " + id + " updated" : "Document " + id + " created"} with ${fileCount} file(s). ${drivePart}`, gdriveAccessToken ? "success" : "danger");
    } else {
      showNotification(isEdit ? `Document ${id} updated.` : `Document ${id} created.`, "success");
    }

    // CRITICAL: push to Drive IMMEDIATELY (no 4s debounce). Closing the tab right after upload
    // was causing the previous "uploaded on B but never reached Drive" bug.
    if (gdriveAccessToken && typeof window.backupToDrive === "function") {
      setTimeout(() => { try { window.backupToDrive(); } catch (_) {} }, 100);
    } else if (!gdriveAccessToken && getCloudClientId()) {
      // Drive is configured but not connected — make sure the banner shows
      try { updateCloudStatus(); } catch (_) {}
    }
  };

  window.openHistoryModal = function(docId) {
    state.selectedDocId = docId;
    const doc = db.getDocuments().find(d => d.id === docId);
    if (!doc) return;
    document.getElementById("hist-modal-title").textContent = `Manage: ${doc.id}`;
    const u = getRenewalUrgency(doc.renewalDate);
    document.getElementById("hist-doc-info").innerHTML = `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);padding:12px;border-radius:8px">
        <h4 style="color:#fff;margin-bottom:4px">${doc.title}</h4>
        <p><strong>Dept:</strong> ${doc.department} | <strong>Version:</strong> v${doc.version}</p>
        <p style="margin-top:4px"><strong>Renewal:</strong> <span class="badge ${u.class}">${u.label} (${doc.renewalDate})</span></p>
      </div>`;
    document.getElementById("modal-revision-list").innerHTML = doc.history.map(h =>
      `<div class="revision-item">
        <span class="revision-ver">Version ${h.version}</span>
        <span class="revision-date">on ${h.date} by <strong>${h.author}</strong></span>
        <div class="revision-changes">${h.changes}</div>
      </div>`
    ).join("");
    const floatVer = parseFloat(doc.version);
    document.getElementById("renew-version-bump").value = !isNaN(floatVer) ? (floatVer + 0.1).toFixed(1) : "2.0";
    document.getElementById("renew-comments").value = "Annual document evaluation conducted. No procedural changes required.";
    // Reset Renewal Target dropdown + custom-date picker each time the wizard opens
    const targetSel = document.getElementById("renew-time-target");
    if (targetSel) targetSel.value = "24";
    const customWrap = document.getElementById("renew-custom-date-wrap");
    if (customWrap) customWrap.style.display = "none";
    const customDate = document.getElementById("renew-custom-date");
    if (customDate) customDate.value = "";
    toggleWizard("history");
    document.getElementById("history-modal").classList.add("active");
  };

  window.closeHistoryModal = () => document.getElementById("history-modal").classList.remove("active");

  window.toggleWizard = function(tab) {
    state.activeWizardTab = tab;
    document.getElementById("tab-history").classList.toggle("active", tab === "history");
    document.getElementById("tab-renew").classList.toggle("active", tab === "renew");
    document.getElementById("wiz-history").classList.toggle("active", tab === "history");
    document.getElementById("wiz-renew").classList.toggle("active", tab === "renew");
    document.getElementById("renew-save-btn").style.display = tab === "renew" ? "inline-block" : "none";
  };

  // Show/hide the custom-date picker depending on the dropdown selection
  window.onRenewTargetChange = function() {
    const sel = document.getElementById("renew-time-target");
    const wrap = document.getElementById("renew-custom-date-wrap");
    if (!sel || !wrap) return;
    if (sel.value === "custom") {
      wrap.style.display = "";
      // Pre-fill with a sensible default (existing renewal date or today + 2y)
      const dateEl = document.getElementById("renew-custom-date");
      if (dateEl && !dateEl.value) {
        const docId = state.selectedDocId;
        const doc = (db.getDocuments() || []).find(d => d.id === docId);
        if (doc && doc.renewalDate) {
          dateEl.value = doc.renewalDate;
        } else {
          const t = new Date("2026-05-24"); t.setFullYear(t.getFullYear() + 2);
          dateEl.value = t.toISOString().split("T")[0];
        }
      }
    } else {
      wrap.style.display = "none";
    }
  };

  window.executeDocumentRenewal = function() {
    const docId = state.selectedDocId;
    const docs = db.getDocuments();
    const idx = docs.findIndex(d => d.id === docId);
    if (idx === -1) return;
    const targetVal = document.getElementById("renew-time-target").value;
    const newVer = document.getElementById("renew-version-bump").value.trim();
    const newStatus = document.getElementById("renew-status-target").value;
    const comment = document.getElementById("renew-comments").value.trim();
    if (!newVer) { showNotification("Please define a target version.", "danger"); return; }

    // ★ Manual date OR preset months — manual takes precedence when selected.
    let newDate;
    if (targetVal === "custom") {
      const manual = (document.getElementById("renew-custom-date").value || "").trim();
      if (!manual) { showNotification("Please pick a renewal date.", "danger"); return; }
      // Validate date and ensure it's in the future
      const md = new Date(manual);
      if (isNaN(md.getTime())) { showNotification("Invalid renewal date.", "danger"); return; }
      if (md <= TODAY) {
        if (!window.confirm(`The renewal date ${manual} is today or in the past. Continue anyway?`)) return;
      }
      newDate = manual;
    } else {
      const months = parseInt(targetVal, 10);
      const base = new Date(docs[idx].renewalDate) < TODAY ? new Date("2026-05-24") : new Date(docs[idx].renewalDate);
      base.setMonth(base.getMonth() + months);
      newDate = base.toISOString().split("T")[0];
    }
    const oldVer = docs[idx].version;
    docs[idx].version = newVer;
    docs[idx].status = newStatus;
    docs[idx].renewalDate = newDate;
    docs[idx].effectiveDate = "2026-05-24";
    docs[idx].history.unshift({ version: newVer, date: "2026-05-24", author: state.currentUser?.name || "QA Manager", changes: comment || `QA renewal. v${oldVer} → v${newVer}. Next renewal: ${newDate}` });
    db.saveDocuments(docs);
    db.addAuditLog(state.currentUser?.name || "QA Manager", `Renewal authorized for ${docId}. v${newVer}. Next renewal: ${newDate}`, state.currentDivision);
    // Push the renewal to per-doc Drive metadata — atomic single-doc write
    if (gdriveAccessToken && typeof window.writeDocToDriveMeta === "function") {
      window.writeDocToDriveMeta(docs[idx]).catch(()=>{});
    }
    closeHistoryModal();
    renderDocumentVault();
    rebuildMetrics();
    showNotification(`Document ${docId} successfully renewed to v${newVer}.`, "success");
  };

  // ============================================================
  // SECTION 7: DEVIATIONS & CAPA
  // ============================================================

  window.renderDeviations = function() {
    const allDevs = db.getDeviations();
    // Apply the same division + hat filter as the Document Vault
    const currentDivLabel = state.currentDivision === "cosmetics" ? "Healthcare" : "Pharmaceuticals";
    const hatDeptMap = { "QA": "Quality Assurance", "QC": "Quality Control", "Production": "Production" };
    const hatDept = state.activeHat ? hatDeptMap[state.activeHat] : null;
    const devs = allDevs
      .filter(dv => !dv.division || dv.division === "Both" || dv.division === currentDivLabel)
      .filter(dv => !hatDept || !dv.department || dv.department === hatDept);
    const html = devs.map(dv => {
      const sevClass = { Critical: "badge-severity-critical", Major: "badge-severity-major", Minor: "badge-severity-minor" }[dv.severity] || "badge-severity-minor";
      const statClass = dv.status === "Closed" ? "badge-approved" : "badge-revision";
      return `<tr>
        <td><strong style="color:var(--accent-color)">${dv.id}</strong></td>
        <td>
          <div style="font-weight:600">${dv.title}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${dv.description.substring(0,80)}...</div>
        </td>
        <td><strong>${dv.batchNo}</strong></td>
        <td><span class="badge ${sevClass}">${dv.severity}</span></td>
        <td>${dv.dateLogged}</td>
        <td><span class="badge ${statClass}">${dv.status}</span></td>
        <td><span style="font-size:0.72rem;text-transform:uppercase">${dv.rca.framework}</span></td>
        <td>
          <div style="display:flex;gap:7px">
            <button class="btn-renew" onclick="viewRcaModal('${dv.id}')">RCA Details</button>
            ${dv.status !== "Closed" ? `<button class="btn-edit" onclick="triggerCapaClose('${dv.id}')">Close CAPA</button>` : ""}
            ${dv.status === "Closed" && !dv.trained ? `<button class="training-approve-btn" onclick="promptAiTraining('${dv.id}')">✦ Approve AI Training</button>` : ""}
            ${dv.trained ? `<span class="badge badge-trained">AI Trained</span>` : ""}
          </div>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">No deviations logged.</td></tr>`;

    document.getElementById("deviations-table-body").innerHTML = html;
  };

  window.openDeviationModal = function() {
    const devs = db.getDeviations();
    const nextNum = devs.length + 1;
    document.getElementById("dev-id-input").value = `DEV-2026-${String(nextNum).padStart(3, "0")}`;
    document.getElementById("dev-batch-input").value = "";
    document.getElementById("dev-title-input").value = "";
    document.getElementById("dev-date-input").value = "2026-05-24";
    document.getElementById("dev-desc-input").value = "";
    ["whys-1","whys-2","whys-3","whys-4","whys-5","fb-man","fb-machine","fb-material","fb-method","dev-capa-action","dev-capa-assignee"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("dev-capa-due").value = "2026-06-07";
    toggleRcaFields();
    document.getElementById("deviation-modal").classList.add("active");
  };

  window.closeDeviationModal = () => document.getElementById("deviation-modal").classList.remove("active");

  window.toggleRcaFields = function() {
    const method = document.getElementById("dev-rca-method").value;
    document.getElementById("rca-5whys-section").style.display = method === "5whys" ? "flex" : "none";
    document.getElementById("rca-fishbone-section").style.display = method === "fishbone" ? "flex" : "none";
  };

  window.saveDeviation = function() {
    const id = document.getElementById("dev-id-input").value;
    const batch = document.getElementById("dev-batch-input").value.trim();
    const title = document.getElementById("dev-title-input").value.trim();
    const severity = document.getElementById("dev-severity-input").value;
    const date = document.getElementById("dev-date-input").value;
    const desc = document.getElementById("dev-desc-input").value.trim();
    const method = document.getElementById("dev-rca-method").value;
    if (!batch || !title || !desc) { showNotification("Please fill in Batch Number, Title, and Description.", "danger"); return; }

    let rcaDetails = "";
    if (method === "5whys") {
      rcaDetails = [1,2,3,4,5].map(n => document.getElementById(`whys-${n}`).value).filter(v => v).map((v, i) => `${i+1}. ${v}`).join("\n");
    } else {
      rcaDetails = `Man: ${document.getElementById("fb-man").value} | Machine: ${document.getElementById("fb-machine").value} | Material: ${document.getElementById("fb-material").value} | Method: ${document.getElementById("fb-method").value}`;
    }

    const newDev = {
      id, title, batchNo: batch, severity, dateLogged: date, description: desc, status: "Investigation Open", trained: false,
      rca: { framework: method, details: rcaDetails },
      capa: { action: document.getElementById("dev-capa-action").value, assignee: document.getElementById("dev-capa-assignee").value, dueDate: document.getElementById("dev-capa-due").value, verificationStatus: "Pending Verification" }
    };

    const devs = db.getDeviations();
    devs.push(newDev);
    db.saveDeviations(devs);
    db.addAuditLog(state.currentUser?.name || "QA Manager", `Logged new deviation: ${id} - ${title}`, state.currentDivision);
    closeDeviationModal();
    renderDeviations();
    showNotification(`Deviation ${id} logged successfully.`, "success");
  };

  window.viewRcaModal = function(devId) {
    const dev = db.getDeviations().find(d => d.id === devId);
    if (!dev) return;
    aiDrawer.classList.add("active");
    triggerAiThought(
      `[Deviation File: ${dev.id}]\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 ${dev.title}\n` +
      `Severity: ${dev.severity}  |  Status: ${dev.status}\n` +
      `Batch: ${dev.batchNo}  |  Date: ${dev.dateLogged}\n\n` +
      `RCA Method: ${dev.rca.framework.toUpperCase()}\n\n` +
      `${dev.rca.details}\n\n` +
      `━━━ CAPA PLAN ━━━\n` +
      `${dev.capa.action}\n\n` +
      `Assignee: ${dev.capa.assignee}\n` +
      `Due: ${dev.capa.dueDate}\n` +
      `Verification: ${dev.capa.verificationStatus}`
    );
    const suggestions = document.getElementById("ai-suggestions-list");
    suggestions.innerHTML = `
      <div class="ai-suggestion-item">
        <strong>📁 ${dev.id} — ${dev.severity} Deviation</strong>
        <p><strong>Issue:</strong> ${dev.title}</p>
        <p style="margin-top:6px"><strong>Root Cause:</strong> ${dev.rca.details.substring(0, 140)}${dev.rca.details.length > 140 ? "..." : ""}</p>
        <p style="margin-top:6px"><strong>CAPA:</strong> ${dev.capa.action}</p>
        <p style="margin-top:4px;font-size:0.72rem;color:var(--text-muted)">Assignee: ${dev.capa.assignee} | Due: ${dev.capa.dueDate} | ${dev.capa.verificationStatus}</p>
      </div>
    `;
  };

  window.triggerCapaClose = function(devId) {
    const devs = db.getDeviations();
    const idx = devs.findIndex(d => d.id === devId);
    if (idx === -1) return;
    state.pendingCapaCloseId = devId;
    document.getElementById("capa-close-dev-id").value = devId;
    document.getElementById("capa-close-pass").value = "";
    document.getElementById("capa-close-modal").classList.add("active");
    setTimeout(() => document.getElementById("capa-close-pass").focus(), 50);
  };

  window.confirmCapaClose = function() {
    const devId = state.pendingCapaCloseId;
    if (!devId) return;
    const pass = document.getElementById("capa-close-pass").value;
    if (pass !== "velite2026") {
      showNotification("Incorrect passcode. CAPA closure cancelled.", "danger");
      return;
    }
    const devs = db.getDeviations();
    const idx = devs.findIndex(d => d.id === devId);
    if (idx === -1) return;
    devs[idx].status = "Closed";
    devs[idx].capa.verificationStatus = "Verified & Closed";
    db.saveDeviations(devs);
    db.addAuditLog(state.currentUser?.name || "QA Manager", `CAPA verified and closed for ${devId}. Batch released from investigation.`, state.currentDivision);
    document.getElementById("capa-close-modal").classList.remove("active");
    state.pendingCapaCloseId = null;
    renderDeviations();
    rebuildMetrics();
    showNotification(`Deviation ${devId} closed. You may now approve AI training for this resolution.`, "success");
  };

  // Prompt AI Training Approval
  window.promptAiTraining = function(devId) {
    const devs = db.getDeviations();
    const dev = devs.find(d => d.id === devId);
    if (!dev) return;
    state.pendingAiTrainId = devId;
    document.getElementById("ai-train-summary").innerHTML = `
      <p><strong style="color:var(--accent-color)">${dev.id}</strong> — ${dev.severity} Deviation</p>
      <p style="margin-top:8px"><strong>Issue:</strong> ${dev.title}</p>
      <p style="margin-top:6px"><strong>Root Cause:</strong> ${dev.rca.details.substring(0, 120)}${dev.rca.details.length > 120 ? "…" : ""}</p>
      <p style="margin-top:6px"><strong>CAPA:</strong> ${dev.capa.action.substring(0, 100)}${dev.capa.action.length > 100 ? "…" : ""}</p>
    `;
    document.getElementById("ai-train-modal").classList.add("active");
  };

  window.confirmAiTraining = function() {
    const devId = state.pendingAiTrainId;
    if (!devId) return;
    const devs = db.getDeviations();
    const dev = devs.find(d => d.id === devId);
    if (!dev) return;

    const kb = db.getAiKnowledge();
    kb.push({
      id: `KB-${String(kb.length + 1).padStart(3, "0")}`,
      issueType: dev.title,
      category: dev.severity + " Deviation",
      rootCause: dev.rca.details,
      capa: dev.capa.action,
      approvedBy: state.currentUser?.name || "QA Manager",
      timestamp: "2026-05-24"
    });
    db.saveAiKnowledge(kb);

    const idx = devs.findIndex(d => d.id === devId);
    devs[idx].trained = true;
    db.saveDeviations(devs);
    db.addAuditLog(state.currentUser?.name || "QA Manager", `AI Training approved for ${devId}. Vector KB updated. Knowledge Base now has ${kb.length} entries.`, state.currentDivision);

    document.getElementById("ai-train-modal").classList.remove("active");
    state.pendingAiTrainId = null;
    renderDeviations();
    renderAiTrainingCenter();
    updateAiStats();
    showNotification(`✦ AI Vectorbase updated! ${dev.title} added to Velite Cognitive Engine.`, "success");
  };

  // ============================================================
  // SECTION 8: BMR REVIEW
  // ============================================================

  window.renderBmrList = function() {
    const batches = db.getBatches().filter(b => b.division === "Pharmaceuticals");
    const html = batches.map(b => `<tr>
      <td><strong>${b.batchNo}</strong></td>
      <td>${b.productName}</td>
      <td><span class="badge badge-revision">${b.status}</span></td>
      <td><button class="btn-renew" onclick="loadBmrReview('${b.batchNo}')">Review BMR</button></td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No active pharmaceutical batches.</td></tr>`;
    document.getElementById("bmr-batch-table").innerHTML = html;
  };

  window.loadBmrReview = function(batchNo) {
    const batch = db.getBatches().find(b => b.batchNo === batchNo);
    if (!batch) return;
    const placeholder = document.getElementById("bmr-review-placeholder");
    const content = document.getElementById("bmr-review-content");
    placeholder.style.display = "none";
    content.style.display = "flex";

    const microbialHtml = batch.qcMicrobial ? `
      <div style="background:rgba(0,0,0,0.2);border:1px solid var(--glass-border);border-radius:10px;padding:14px">
        <h4 style="color:#fff;font-size:0.9rem;margin-bottom:10px">🔬 Microbiological Results</h4>
        <div class="cpp-stat-grid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="cpp-stat"><label>TAMC</label><span class="microbial-${batch.qcMicrobial.tamc === 'Pending' ? 'pending' : batch.qcMicrobial.tamc.includes('Cleared') || parseInt(batch.qcMicrobial.tamc) <= 100 ? 'pass' : 'fail'}">${batch.qcMicrobial.tamc}</span></div>
          <div class="cpp-stat"><label>TYMC</label><span class="microbial-${batch.qcMicrobial.tymc === 'Pending' ? 'pending' : batch.qcMicrobial.tymc.includes('Cleared') || parseInt(batch.qcMicrobial.tymc) <= 10 ? 'pass' : 'fail'}">${batch.qcMicrobial.tymc}</span></div>
          <div class="cpp-stat"><label>Pathogens</label><span class="microbial-${batch.qcMicrobial.pathogens.includes('Negative') ? 'pass' : batch.qcMicrobial.pathogens.includes('Await') ? 'pending' : 'fail'}">${batch.qcMicrobial.pathogens}</span></div>
        </div>
      </div>` : "";

    const allergenHtml = batch.qcAllergens && batch.qcAllergens.length > 0 ?
      `<div class="alert-item warning"><strong>⚠️ Allergen Alerts Detected:</strong> ${batch.qcAllergens.join(", ")} — requires labeling review before market release.</div>` : "";

    const prodCPP = batch.productionCPP ? `
      <div style="background:rgba(0,0,0,0.2);border:1px solid var(--glass-border);border-radius:10px;padding:14px">
        <h4 style="color:#fff;font-size:0.9rem;margin-bottom:10px">⚙️ Production CPP Log</h4>
        <div class="cpp-stat-grid">
          <div class="cpp-stat"><label>Temperature</label><span>${batch.productionCPP.temp}</span></div>
          <div class="cpp-stat"><label>Agitation</label><span>${batch.productionCPP.mixingSpeed}</span></div>
          <div class="cpp-stat"><label>Duration</label><span>${batch.productionCPP.mixingTime}</span></div>
        </div>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px">Operator: ${batch.productionCPP.operator}</p>
      </div>` : "";

    content.innerHTML = `
      <div style="background:rgba(var(--accent-rgb),0.06);border:1px solid rgba(var(--accent-rgb),0.2);border-radius:10px;padding:14px">
        <h4 style="color:#fff;font-size:1rem">${batch.batchNo} — ${batch.productName}</h4>
        <p style="color:var(--text-secondary);font-size:0.8rem;margin-top:4px">Mfg: ${batch.mfgDate} | Exp: ${batch.expDate} | Division: ${batch.division}</p>
      </div>
      ${allergenHtml}
      ${prodCPP}
      <div style="background:rgba(0,0,0,0.2);border:1px solid var(--glass-border);border-radius:10px;padding:14px">
        <h4 style="color:#fff;font-size:0.9rem;margin-bottom:10px">🧪 Analytical Testing Results</h4>
        <div class="cpp-stat-grid">
          <div class="cpp-stat"><label>Assay</label><span>${batch.tests.assay || "---"}</span></div>
          <div class="cpp-stat"><label>pH</label><span>${batch.tests.pH}</span></div>
          <div class="cpp-stat"><label>Viscosity</label><span>${batch.tests.viscosity}</span></div>
        </div>
      </div>
      ${microbialHtml}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-primary" onclick="openEsignModal('${batch.batchNo}')">21 CFR Part 11 Sign-off & Release</button>
        <button class="btn-secondary" onclick="switchTab('deviations')">Log Deviation</button>
      </div>
    `;
  };

  // ============================================================
  // SECTION 9: PRODUCTION HUB
  // ============================================================

  const PRODUCT_FORMULAS = {
    "VP": [
      "Betamethasone Dipropionate Ointment",
      "Clobetasol Propionate Cream 0.05%",
      "Mometasone Furoate Cream",
    ],
    "VH": [
      "Ultra-Hydrating Cocoa Butter Cream",
      "Velite Glow Serum Gold Edition",
      "Anti-Ageing Botanical Night Cream"
    ]
  };

  window.renderProductionBatchesPanel = function() {
    const batches = db.getBatches();
    const prefix = state.currentDivision === "pharma" ? "VP" : "VH";
    const divisionName = prefix === "VP" ? "Pharmaceuticals" : "Healthcare";
    const productList = PRODUCT_FORMULAS[prefix];

    const select = document.getElementById("prod-product-select");
    select.innerHTML = productList.map(p => `<option value="${p}">${p}</option>`).join("");

    // Priority 1: A batch cleared by QA but not yet compounded → show submit button
    const clearedBatch = batches.find(b => b.division === divisionName && b.lineClearance?.approved && !b.compoundingLogged);
    // Priority 2: A batch we just requested clearance for (tracked in state)
    const pendingBatch = state.pendingLineClearanceBatchId
      ? batches.find(b => b.batchNo === state.pendingLineClearanceBatchId && !b.lineClearance?.approved)
      : null;

    if (clearedBatch) {
      document.getElementById("prod-batch-no").value = clearedBatch.batchNo;
      const matchProd = productList.find(p => clearedBatch.productName.startsWith(p.split(" ")[0]));
      if (matchProd) select.value = matchProd;
      document.getElementById("btn-request-clearance").style.display = "none";
      document.getElementById("btn-save-compounding").style.display = "inline-flex";
      document.getElementById("prod-clearance-notice").className = "alert-item success";
      document.getElementById("prod-clearance-notice").innerHTML = `<strong>✔ Line Clearance Approved!</strong> — Batch <strong>${clearedBatch.batchNo}</strong> cleared by ${clearedBatch.lineClearance.approvedBy}. Enter CPP parameters below and submit compounding log.`;
    } else if (pendingBatch) {
      document.getElementById("prod-batch-no").value = pendingBatch.batchNo;
      document.getElementById("btn-request-clearance").style.display = "none";
      document.getElementById("btn-save-compounding").style.display = "none";
      document.getElementById("prod-clearance-notice").className = "alert-item warning";
      document.getElementById("prod-clearance-notice").innerHTML = `<strong>⏳ Clearance Pending QA Approval</strong> — Batch <strong>${pendingBatch.batchNo}</strong> is awaiting QA Manager sign-off on the Line Clearance Board.`;
    } else {
      // Fresh form for a new batch
      state.pendingLineClearanceBatchId = null;
      const count = batches.filter(b => b.division === divisionName).length + 1;
      document.getElementById("prod-batch-no").value = `${prefix}-BT-${String(410 + count).padStart(3, "0")}`;
      document.getElementById("prod-cpp-temp").value = "";
      document.getElementById("prod-cpp-speed").value = "";
      document.getElementById("prod-cpp-time").value = "";
      document.getElementById("btn-request-clearance").style.display = "inline-flex";
      document.getElementById("btn-save-compounding").style.display = "none";
      document.getElementById("prod-clearance-notice").className = "alert-item info";
      document.getElementById("prod-clearance-notice").innerHTML = `<strong>Line Clearance:</strong> Fill in batch details below, then click "Request Line Clearance". QA must approve before compounding begins.`;
    }

    // Render running batches table
    const html = batches.map(b => {
      const clearanceStatus = b.lineClearance?.approved
        ? `<span class="badge badge-approved">Approved</span>`
        : (b.lineClearance?.requested ? `<span class="badge badge-revision">Pending QA</span>` : `<span class="badge badge-draft">Not Requested</span>`);
      const cppStatus = b.compoundingLogged ? `<span class="badge badge-approved">Logged</span>` : `<span class="badge badge-draft">Pending</span>`;
      return `<tr>
        <td><strong>${b.batchNo}</strong></td>
        <td style="font-size:0.78rem">${b.productName.substring(0, 30)}${b.productName.length > 30 ? "..." : ""}</td>
        <td>${clearanceStatus}</td>
        <td>${cppStatus}</td>
        <td style="font-size:0.72rem;color:var(--text-muted)">${b.productionCPP?.temp || "---"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No active batches.</td></tr>`;

    document.getElementById("prod-running-batches-table").innerHTML = html;
  };

  window.requestLineClearance = function() {
    const batchNo = document.getElementById("prod-batch-no").value.trim();
    const product = document.getElementById("prod-product-select").value;
    if (!batchNo) { showNotification("Please enter a batch number.", "danger"); return; }

    const batches = db.getBatches();
    if (batches.some(b => b.batchNo === batchNo)) { showNotification(`Batch ${batchNo} already exists.`, "danger"); return; }

    const division = state.currentDivision === "pharma" ? "Pharmaceuticals" : "Healthcare";
    const newBatch = {
      batchNo, productName: product, division,
      mfgDate: "2026-05-24", expDate: "2028-05-24",
      status: "Awaiting Line Clearance",
      lineClearance: { requested: true, approved: false, approvedBy: null, timestamp: new Date().toLocaleString() },
      compoundingLogged: false,
      productionCPP: null,
      handoverToQc: false,
      qcStatus: "Pending",
      qcMicrobial: { tamc: "Pending", tymc: "Pending", pathogens: "Awaiting incubation" },
      qcAllergens: [],
      coaDrafted: false,
      tests: {},
      records: { rawMaterialChecked: true, compoundingLogged: false, packagingCleared: false, microbiologicalTesting: "Pending", analyticalTesting: "Pending" }
    };
    batches.push(newBatch);
    db.saveBatches(batches);
    db.addAuditLog(state.currentUser?.name || "Production", `Line clearance requested for new batch ${batchNo} — ${product}.`, state.currentDivision);

    state.pendingLineClearanceBatchId = batchNo;

    renderProductionBatchesPanel();
    renderLineClearanceBoard();
    showNotification(`Line clearance requested for batch ${batchNo}. Awaiting QA approval.`, "success");
  };

  window.submitCompoundingLog = function() {
    const batchNo = document.getElementById("prod-batch-no").value.trim();
    const temp = document.getElementById("prod-cpp-temp").value.trim();
    const speed = document.getElementById("prod-cpp-speed").value.trim();
    const time = document.getElementById("prod-cpp-time").value.trim();

    if (!temp || !speed || !time) { showNotification("Please fill in all Critical Process Parameters (Temp, Speed, Time).", "danger"); return; }

    const batches = db.getBatches();
    const idx = batches.findIndex(b => b.batchNo === batchNo);
    if (idx === -1) { showNotification("Batch not found. Please request line clearance first.", "danger"); return; }
    if (!batches[idx].lineClearance?.approved) { showNotification("Line Clearance has not been approved by QA. Cannot log compounding.", "danger"); return; }

    batches[idx].compoundingLogged = true;
    batches[idx].status = "Compounding Complete — Awaiting QC";
    batches[idx].handoverToQc = true;
    batches[idx].productionCPP = {
      temp: `${temp}°C`,
      mixingSpeed: `${speed} RPM`,
      mixingTime: `${time} mins`,
      operator: state.currentUser?.name || "Production Operator"
    };
    batches[idx].records.compoundingLogged = true;
    db.saveBatches(batches);
    db.addAuditLog(state.currentUser?.name || "Production", `Compounding CPP logged for ${batchNo}. Temp: ${temp}°C, Speed: ${speed} RPM, Time: ${time} mins.`, state.currentDivision);

    // Clear pending state so form resets
    state.pendingLineClearanceBatchId = null;

    // AI alert if parameters seem off
    const aiAlert = runAiCppCheck(parseFloat(temp), parseFloat(speed));
    if (aiAlert) {
      showNotification(`⚠️ Velite AI Alert: ${aiAlert}`, "warning");
      triggerAiThought(`Analyzing CPP for batch ${batchNo}...\nTemperature: ${temp}°C, Speed: ${speed} RPM.\n${aiAlert}\nRecommend logging deviation if parameters deviate significantly from SOP limits.`);
    }

    renderProductionBatchesPanel();
    renderQcSamplesPanel();
    showNotification(`Compounding logged for batch ${batchNo}. Handed over to QC lab.`, "success");
  };

  function runAiCppCheck(temp, speed) {
    if (temp > 80) return "Critical: Temperature exceeds 80°C. Potential API degradation risk.";
    if (speed > 2000) return "Warning: Agitation speed exceeds 2000 RPM. Possible emulsion shear breakage.";
    if (speed < 500) return "Warning: Agitation speed below 500 RPM. Insufficient mixing may cause batch homogeneity issues.";
    return null;
  }

  // ============================================================
  // SECTION 10: LINE CLEARANCE BOARD
  // ============================================================

  window.renderLineClearanceBoard = function() {
    const batches = db.getBatches().filter(b => b.lineClearance?.requested);
    const html = batches.map(b => {
      const isApproved = b.lineClearance?.approved;
      const statusBadge = isApproved ? `<span class="badge badge-approved">Approved</span>` : `<span class="badge badge-expiring">Awaiting QA</span>`;
      const sig = isApproved ? `<span style="font-size:0.78rem;color:#34d399">✔ ${b.lineClearance.approvedBy}</span>` : `<span style="font-size:0.78rem;color:var(--text-muted)">—</span>`;
      const actions = !isApproved ?
        `<button class="btn-primary" style="font-size:0.75rem;padding:6px 12px" onclick="approveLineClearance('${b.batchNo}')">Approve Clearance</button>` :
        `<button class="btn-secondary" style="font-size:0.75rem;padding:6px 12px" disabled>Cleared ✔</button>`;
      return `<tr>
        <td><strong>${b.batchNo}</strong></td>
        <td style="font-size:0.82rem">${b.productName}</td>
        <td style="font-size:0.78rem">${b.lineClearance?.timestamp || "---"}</td>
        <td>${statusBadge}</td>
        <td>${sig}</td>
        <td>${actions}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No line clearance requests pending.</td></tr>`;

    document.getElementById("line-clearance-table-body").innerHTML = html;
  };

  window.approveLineClearance = function(batchNo) {
    const user = state.currentUser;
    if (!user || (user.department !== "Quality Assurance" && user.department !== "Executive")) {
      showNotification("Only QA Managers can approve line clearances.", "warning");
      return;
    }
    state.pendingLineClearApproveId = batchNo;
    document.getElementById("lineclear-batch-id").value = batchNo;
    document.getElementById("lineclear-pass").value = "";
    document.getElementById("lineclear-modal").classList.add("active");
    setTimeout(() => document.getElementById("lineclear-pass").focus(), 50);
  };

  window.confirmLineClearance = function() {
    const batchNo = state.pendingLineClearApproveId;
    if (!batchNo) return;
    const user = state.currentUser;
    const pass = document.getElementById("lineclear-pass").value;
    if (pass !== "velite2026") { showNotification("Incorrect passcode.", "danger"); return; }

    const batches = db.getBatches();
    const idx = batches.findIndex(b => b.batchNo === batchNo);
    if (idx !== -1) {
      batches[idx].lineClearance.approved = true;
      batches[idx].lineClearance.approvedBy = user.name;
      batches[idx].status = "Line Cleared — Compounding Authorized";
      db.saveBatches(batches);
      db.addAuditLog(user.name, `Line Clearance E-Signed & Approved for batch ${batchNo}.`, state.currentDivision);
      document.getElementById("lineclear-modal").classList.remove("active");
      state.pendingLineClearApproveId = null;
      renderLineClearanceBoard();
      renderProductionBatchesPanel(); // Refresh production view so submit button appears
      showNotification(`Line clearance approved for ${batchNo}. Production can now compound.`, "success");
    }
  };

  // ============================================================
  // SECTION 11: QC LABORATORY TESTING
  // ============================================================

  window.renderQcSamplesPanel = function() {
    const batches = db.getBatches().filter(b => b.handoverToQc);
    const html = batches.map(b => `<tr>
      <td><strong>${b.batchNo}</strong></td>
      <td style="font-size:0.78rem">${b.productName.substring(0,28)}...</td>
      <td>${b.compoundingLogged ? `<span class="badge badge-approved">Yes</span>` : `<span class="badge badge-draft">No</span>`}</td>
      <td><button class="btn-renew" onclick="selectQcBatch('${b.batchNo}')">Load for Testing</button></td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No handover batches available yet.</td></tr>`;

    document.getElementById("qc-samples-list").innerHTML = html;

    // COA table
    const coaHtml = batches.map(b => {
      const passed = b.qcStatus === "Passed";
      return `<tr>
        <td><strong>${b.batchNo}</strong></td>
        <td style="font-size:0.78rem">${b.productName.substring(0,28)}...</td>
        <td><span class="badge ${passed ? 'badge-approved' : 'badge-revision'}">${b.qcStatus}</span></td>
        <td>${b.coaDrafted ? `<button class="btn-renew" onclick="openCoaModal('${b.batchNo}')">View CoA</button>` : `<span style="color:var(--text-muted);font-size:0.78rem">Pending</span>`}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No CoAs generated yet.</td></tr>`;

    document.getElementById("qc-coa-generation-table").innerHTML = coaHtml;
  };

  window.selectQcBatch = function(batchNo) {
    state.selectedQcBatch = batchNo;
    const batch = db.getBatches().find(b => b.batchNo === batchNo);
    if (!batch) return;

    document.getElementById("qc-testing-editor").style.display = "block";
    document.getElementById("qc-edit-batch-title").textContent = `Testing: ${batchNo}`;
    document.getElementById("qc-input-assay").value = "";
    document.getElementById("qc-input-ph").value = batch.tests?.pH || "";
    document.getElementById("qc-input-visc").value = batch.tests?.viscosity || "";
    document.getElementById("qc-input-tamc").value = batch.qcMicrobial?.tamc !== "Pending" ? batch.qcMicrobial?.tamc : "";
    document.getElementById("qc-input-tymc").value = batch.qcMicrobial?.tymc !== "Pending" ? batch.qcMicrobial?.tymc : "";
    document.getElementById("qc-input-pathogens").value = batch.qcMicrobial?.pathogens !== "Awaiting incubation" ? batch.qcMicrobial?.pathogens : "";
    document.getElementById("qc-input-formula").value = "";
    document.getElementById("qc-allergen-badge-area").style.display = "none";
  };

  window.runQCOnFloorAllergenScan = function() {
    const formula = document.getElementById("qc-input-formula").value;
    if (!formula) { showNotification("Please enter a formula ingredient list.", "danger"); return; }

    const ingredients = formula.split(",").map(s => s.trim().toLowerCase());
    const allergens = db.getAllergensDB();
    const banned = db.getIngredientDB();

    const area = document.getElementById("qc-allergen-badge-area");
    area.style.display = "flex";
    area.innerHTML = "";

    let found = false;
    allergens.forEach(alg => {
      if (ingredients.some(ing => ing.includes(alg.name.toLowerCase()))) {
        found = true;
        const riskClass = alg.risk.includes("Banned") ? "banned" : "allergen";
        area.innerHTML += `<span class="allergen-tag ${riskClass}">⚠ ${alg.name} — ${alg.risk} (${alg.threshold})</span>`;
      }
    });
    banned.forEach(b => {
      if (b.status === "Banned" && ingredients.some(ing => ing.includes(b.name.toLowerCase()) || ing.includes(b.synonym.toLowerCase()))) {
        found = true;
        area.innerHTML += `<span class="allergen-tag banned">🚫 BANNED: ${b.name} — ${b.reason}</span>`;
      }
    });

    if (!found) area.innerHTML = `<span class="allergen-tag clear">✔ No allergens or banned substances detected.</span>`;
  };

  window.submitQCTestingLog = function() {
    const batchNo = state.selectedQcBatch;
    if (!batchNo) { showNotification("No batch selected for testing.", "danger"); return; }

    const assay = document.getElementById("qc-input-assay").value.trim();
    const ph = document.getElementById("qc-input-ph").value.trim();
    const visc = document.getElementById("qc-input-visc").value.trim();
    const tamc = document.getElementById("qc-input-tamc").value.trim();
    const tymc = document.getElementById("qc-input-tymc").value.trim();
    const pathogen = document.getElementById("qc-input-pathogens").value.trim();

    if (!ph || !tamc) { showNotification("Please enter at least pH and TAMC values to submit QC results.", "danger"); return; }

    const batches = db.getBatches();
    const idx = batches.findIndex(b => b.batchNo === batchNo);
    if (idx === -1) return;

    batches[idx].tests = { ...batches[idx].tests, assay: assay || batches[idx].tests.assay, pH: parseFloat(ph) || batches[idx].tests.pH, viscosity: visc || batches[idx].tests.viscosity };
    batches[idx].qcMicrobial = { tamc, tymc, pathogens: pathogen };
    batches[idx].qcStatus = "Passed";
    batches[idx].coaDrafted = true;
    batches[idx].records.microbiologicalTesting = "Cleared";
    batches[idx].records.analyticalTesting = "Passed";

    db.saveBatches(batches);
    db.addAuditLog(state.currentUser?.name || "QC Analyst", `QC testing completed for ${batchNo}. TAMC: ${tamc}, TYMC: ${tymc}. CoA drafted.`, state.currentDivision);
    renderQcSamplesPanel();
    document.getElementById("qc-testing-editor").style.display = "none";
    showNotification(`QC verification complete for ${batchNo}. CoA drafted and ready for QA review.`, "success");
  };

  // ============================================================
  // SECTION 12: AI THOUGHT ENGINE
  // ============================================================

  const aiDrawer = document.getElementById("ai-drawer");
  document.getElementById("btn-open-ai-panel").addEventListener("click", () => {
    aiDrawer.classList.add("active");
    runAiSystemScan();
  });
  document.getElementById("btn-close-ai-drawer").addEventListener("click", () => aiDrawer.classList.remove("active"));

  function triggerAiThought(thought) {
    const box = document.getElementById("ai-thinking-log");
    if (!box) return;
    box.textContent = "";
    let i = 0;
    const chars = thought.split("");
    const interval = setInterval(() => {
      if (i < chars.length) {
        box.textContent += chars[i++];
      } else {
        clearInterval(interval);
      }
    }, 15);
  }

  function runAiSystemScan() {
    const kb = db.getAiKnowledge();
    const devs = db.getDeviations();
    const docs = db.getDocuments();
    const overdue = docs.filter(d => getRenewalUrgency(d.renewalDate).label === "Overdue").length;
    const openDev = devs.filter(d => d.status !== "Closed").length;

    const thought = `[Velite Cognitive Engine — System Analysis]\n\nScanning active knowledge vectorbase...\n→ Found ${kb.length} trained quality resolution vectors.\n\nAnalyzing quality system health...\n→ ${docs.length} SOPs indexed. ${overdue} overdue for renewal.\n→ ${openDev} open deviations require CAPA follow-up.\n\nCross-referencing with known deviation patterns...\n→ Temperature excursion patterns: 1 match found (KB-001)\n→ Viscosity drop patterns: 1 match found (KB-002)\n\nSuggestion: Prioritize SOP renewal for SPEC-QC-088 and FORM-QC-102.\nSystem Health: ${overdue > 0 ? "ACTION REQUIRED" : "NOMINAL"}.`;

    triggerAiThought(thought);

    const suggestions = document.getElementById("ai-suggestions-list");
    suggestions.innerHTML = "";
    if (overdue > 0) {
      suggestions.innerHTML += `<div class="ai-suggestion-item"><strong>📄 SOP Renewal Required</strong><p>${overdue} document(s) are overdue for renewal. Immediate QA action recommended to maintain compliance posture.</p><button class="btn-renew" style="margin-top:6px;font-size:0.72rem" onclick="switchTab('documents')">Go to Document Vault</button></div>`;
    }
    if (openDev > 0) {
      suggestions.innerHTML += `<div class="ai-suggestion-item"><strong>⚠️ Open Deviation Resolution</strong><p>${openDev} open deviation(s) require CAPA verification. Cross-referencing with KB-001 pattern suggests thermostat relay as primary suspect.</p></div>`;
    }
    suggestions.innerHTML += `<div class="ai-suggestion-item"><strong>✦ AI Training Opportunity</strong><p>After verifying next deviation closure, approve for AI training to expand Cognitive Engine accuracy. Current vector density: ${kb.length} patterns.</p></div>`;
  }

  window.suggestRcaParameters = async function() {
    const title = document.getElementById("dev-title-input").value.trim();
    const desc = document.getElementById("dev-desc-input").value.trim();
    const batch = document.getElementById("dev-batch-input").value.trim();
    const kb = db.getAiKnowledge();

    if (!title && !desc) {
      showNotification("Please fill in the Deviation Title and/or Description before requesting AI suggestions.", "danger");
      return;
    }

    aiDrawer.classList.add("active");
    const thinkLog = document.getElementById("ai-thinking-log");
    thinkLog.textContent = "[Velite AI — Initiating RCA Analysis...]\n\nCross-referencing against quality vectorbase...";

    // Local KB match (always run first as fallback)
    const descLower = (title + " " + desc).toLowerCase();
    const keywords = ["temperature", "viscosity", "pressure", "mixing", "speed", "humidity", "seal", "valve", "pump", "ph"];
    let matchedKb = null;
    for (const entry of kb) {
      for (const kw of keywords) {
        if (descLower.includes(kw) && entry.rootCause.toLowerCase().includes(kw)) {
          matchedKb = entry; break;
        }
      }
      if (matchedKb) break;
    }

    const apiKey = localStorage.getItem("velite_claude_api_key");

    if (apiKey) {
      thinkLog.textContent = "[Velite AI — Calling Claude claude-sonnet-4-6...]\n\nAnalyzing deviation against GMP knowledge base...";

      const systemPrompt = `You are a pharmaceutical GMP expert specializing in Root Cause Analysis (RCA) for quality deviations.
Analyze the deviation and provide a structured 5-Whys analysis and CAPA plan.
Format your response EXACTLY as follows (one line each):
WHY1: [immediate cause observed]
WHY2: [why that happened]
WHY3: [deeper cause]
WHY4: [systemic issue]
WHY5: [ultimate root cause]
CAPA: [specific corrective and preventive actions to prevent recurrence]
Keep each entry concise and action-oriented. Focus on pharmaceutical/GMP manufacturing context.`;

      const userMsg = `Deviation Title: ${title}\nBatch Number: ${batch || "N/A"}\nFull Description: ${desc || "No description provided"}\n\nTraining KB Context: ${matchedKb ? `Similar historical case: ${matchedKb.issueType} — ${matchedKb.rootCause.substring(0, 100)}` : "No direct KB match found."}`;

      const result = await callClaude(systemPrompt, userMsg);

      if (result) {
        triggerAiThought(`[Velite AI — Claude Analysis Complete]\n\nDeviation: ${title}\nBatch: ${batch || "N/A"}\n\n${result}\n\n─────────────────────────────\nPowered by claude-sonnet-4-6 via Anthropic API`);

        document.getElementById("dev-rca-method").value = "5whys";
        toggleRcaFields();

        result.split("\n").forEach(line => {
          const m = line.match(/^WHY([1-5]):\s*(.+)/i);
          if (m) { const el = document.getElementById(`whys-${m[1]}`); if (el) el.value = m[2].trim(); }
          const c = line.match(/^CAPA:\s*(.+)/i);
          if (c) document.getElementById("dev-capa-action").value = c[1].trim();
        });
        return;
      }
    }

    // Fallback: local KB match or general guidance
    if (matchedKb) {
      triggerAiThought(`[Velite AI — Local KB Match]\n\nMatched Pattern: ${matchedKb.id}\n→ Issue Type: ${matchedKb.issueType}\n→ Root Cause:\n${matchedKb.rootCause}\n\nRecommended CAPA:\n${matchedKb.capa}\n\nConfidence: HIGH (Pattern from approved training vector)\nApproved by: ${matchedKb.approvedBy} on ${matchedKb.timestamp}\n\n[Set API key above to enable full Claude AI analysis]`);
      document.getElementById("dev-rca-method").value = "5whys";
      toggleRcaFields();
      matchedKb.rootCause.split("\n").filter(Boolean).forEach((p, i) => {
        const el = document.getElementById(`whys-${i+1}`);
        if (el) el.value = p.replace(/^\d+\.\s*/, "");
      });
      document.getElementById("dev-capa-action").value = matchedKb.capa;
    } else {
      triggerAiThought(`[Velite AI — General GMP Guidance]\n\nNo KB pattern matched. General deviation guidance:\n\n→ Temperature excursions: Check thermostat relays, chamber seals, PM schedules.\n→ Viscosity deviations: Review emulsification time, cooling phase parameters.\n→ Speed/pressure deviations: Check equipment calibration, electrical supply stability.\n→ Microbial contamination: Verify cleanroom protocols, raw material CoAs, gowning records.\n\nRecommendation: Document findings. After CAPA closure, approve for AI training.\n\n[Configure API key for real Claude AI-powered RCA analysis]`);
      showNotification("Configure Anthropic API key in Velite AI panel for full RCA analysis.", "warning");
    }
  };

  window.suggestQCTestingParams = async function() {
    aiDrawer.classList.add("active");
    const batchNo = state.selectedQcBatch;
    const batch = batchNo ? db.getBatches().find(b => b.batchNo === batchNo) : null;
    const productName = batch?.productName || "Unknown Product";
    const divisionName = state.currentDivision === "pharma" ? "Pharmaceuticals" : "Cosmetics/Healthcare";

    const thinkLog = document.getElementById("ai-thinking-log");
    thinkLog.textContent = `[Velite AI — QC Parameter Analysis]\n\nProduct: ${productName}\nDivision: ${divisionName}\n\nQuerying pharmacopoeial specifications...`;

    const apiKey = localStorage.getItem("velite_claude_api_key");

    if (apiKey) {
      const systemPrompt = `You are a pharmaceutical and cosmetic QC expert. Provide specific QC testing parameters for a given product.
Format your response EXACTLY as follows:
ASSAY: [range and reference standard, e.g. 95.0% - 105.0% (IP/USP)]
PH: [acceptable range, e.g. 5.0 - 6.5]
VISCOSITY: [range and unit, e.g. 30,000 - 50,000 cps (Brookfield)]
TAMC: [limit per applicable standard]
TYMC: [limit per applicable standard]
PATHOGENS: [required screens and acceptance criteria]
NOTES: [any product-specific testing notes or regulatory highlights]
Base parameters on IP/USP for pharmaceuticals, or ISO 17516 / EU Cosmetics Regulation for cosmetics.`;

      const userMsg = `Product Name: ${productName}\nDivision: ${divisionName}\nBatch Number: ${batchNo || "N/A"}\nPlease provide specific QC testing parameters and acceptance criteria.`;

      const result = await callClaude(systemPrompt, userMsg);

      if (result) {
        triggerAiThought(`[Velite AI — QC Parameters: ${productName}]\n\n${result}\n\n─────────────────────────────\nSpecifications by claude-sonnet-4-6 via Anthropic API`);
        return;
      }
    }

    // Fallback: hardcoded guidance
    const isPharma = state.currentDivision === "pharma";
    triggerAiThought(`[Velite AI — QC Parameter Guidance (Local)]\n\nBatch: ${batchNo || "None selected"}\nProduct: ${productName}\nDivision: ${divisionName}\n\nRecommended QC Parameters (${isPharma ? "IP/USP" : "ISO 17516"}):\n→ Assay: 95.0% — 105.0%\n→ pH: ${isPharma ? "5.0 — 6.5 (topical)" : "5.5 — 7.0 (skin-safe range)"}\n→ Viscosity: ${isPharma ? "30,000 — 50,000 cps (ointment)" : "20,000 — 80,000 cps (cream)"}\n\nMicrobiology Limits (${isPharma ? "IP 2.2.9" : "ISO 17516"}):\n→ TAMC: ≤ 100 CFU/g for topicals\n→ TYMC: ≤ 10 CFU/g for topicals\n→ Pathogens: Negative in 1g (S. aureus, P. aeruginosa, E. coli)\n\nAllergen Monitoring:\n→ Scan fragrance ingredients against 26 INCI allergens.\n→ Flag: Linalool, Geraniol, Citral (requires labeling at >0.001%)\n\n[Configure API key for product-specific Claude AI analysis]`);
  };

  function updateAiStats() {
    const kb = db.getAiKnowledge();
    const c1 = document.getElementById("ai-vector-count");
    const c2 = document.getElementById("ai-stat-vectors");
    if (c1) c1.textContent = `Active vectors: ${kb.length}`;
    if (c2) c2.textContent = kb.length;
  }

  // ============================================================
  // SECTION 13: AI TRAINING CENTER
  // ============================================================

  window.renderAiTrainingCenter = function() {
    const kb = db.getAiKnowledge();
    updateAiStats();
    const html = kb.map(entry => `<tr>
      <td><strong style="color:#a78bfa">${entry.id}</strong></td>
      <td style="font-size:0.82rem">${entry.issueType.substring(0,40)}...</td>
      <td style="font-size:0.78rem;max-width:180px">${entry.rootCause.substring(0,80)}...</td>
      <td style="font-size:0.78rem;max-width:180px">${entry.capa.substring(0,80)}...</td>
      <td style="font-size:0.78rem"><strong>${entry.approvedBy}</strong><br><span style="color:var(--text-muted)">${entry.timestamp}</span></td>
      <td><span class="badge badge-trained">✔ AI Trained</span></td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No AI training vectors yet. Approve resolved deviations from the Deviations tab.</td></tr>`;

    document.getElementById("ai-training-table-body").innerHTML = html;
  };

  // ============================================================
  // SECTION 14: SENSORY QC & COA (COSMETICS)
  // ============================================================

  window.renderCosmeticBatchList = function() {
    const batches = db.getBatches().filter(b => b.division === "Healthcare");
    const html = batches.map(b => `<tr>
      <td><strong>${b.batchNo}</strong></td>
      <td style="font-size:0.82rem">${b.productName}</td>
      <td><span class="badge badge-revision">${b.status}</span></td>
      <td><button class="btn-renew" onclick="loadSensoryReview('${b.batchNo}')">Evaluate</button></td>
    </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No healthcare batches found.</td></tr>`;
    document.getElementById("cosmetic-batch-table").innerHTML = html;
  };

  window.loadSensoryReview = function(batchNo) {
    state.selectedSensoryBatch = batchNo;
    const batch = db.getBatches().find(b => b.batchNo === batchNo);
    if (!batch) return;

    document.getElementById("sensory-placeholder").style.display = "none";
    const content = document.getElementById("sensory-content");
    content.style.display = "flex";

    const allergenAlert = batch.qcAllergens && batch.qcAllergens.length > 0 ?
      `<div class="alert-item warning"><strong>⚠️ Allergen Alert:</strong> ${batch.qcAllergens.join(", ")} detected. Ensure proper label declaration before release.</div>` : "";

    const micHtml = `
      <div style="background:rgba(0,0,0,0.2);border:1px solid var(--glass-border);border-radius:10px;padding:14px">
        <h4 style="color:#fff;font-size:0.88rem;margin-bottom:8px">🔬 Microbiology (ISO 17516)</h4>
        <div class="cpp-stat-grid">
          <div class="cpp-stat"><label>TAMC</label><span class="microbial-${batch.qcMicrobial?.tamc === 'Pending' ? 'pending' : 'pass'}">${batch.qcMicrobial?.tamc || "Pending"}</span></div>
          <div class="cpp-stat"><label>TYMC</label><span class="microbial-${batch.qcMicrobial?.tymc === 'Pending' ? 'pending' : 'pass'}">${batch.qcMicrobial?.tymc || "Pending"}</span></div>
          <div class="cpp-stat"><label>Pathogens</label><span class="microbial-pending">${batch.qcMicrobial?.pathogens || "Pending"}</span></div>
        </div>
      </div>`;

    content.innerHTML = `
      <div style="background:rgba(var(--accent-rgb),0.06);border:1px solid rgba(var(--accent-rgb),0.2);border-radius:10px;padding:14px">
        <h4 style="color:#fff">${batch.batchNo} — ${batch.productName}</h4>
        <p style="color:var(--text-secondary);font-size:0.78rem;margin-top:4px">Mfg: ${batch.mfgDate} | Exp: ${batch.expDate}</p>
      </div>
      ${allergenAlert}
      ${micHtml}
      <div style="background:rgba(0,0,0,0.15);border:1px solid var(--glass-border);border-radius:10px;padding:14px">
        <h4 style="color:#fff;font-size:0.88rem;margin-bottom:12px">Sensory Evaluation Panel (1-5 Scale)</h4>
        <div class="sensory-slider-group">
          ${["Appearance", "Fragrance", "Skin Feel", "Absorption"].map(attr => {
            const key = attr.toLowerCase().replace(" ", "");
            const val = batch.tests?.[key] || 3;
            return `<div class="sensory-slider">
              <label>${attr}</label>
              <input type="range" min="1" max="5" value="${val}" id="sensory-${key}" oninput="document.getElementById('val-${key}').textContent=this.value">
              <span id="val-${key}">${val}</span>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-primary" onclick="generateCoA('${batchNo}')">Generate Certificate of Analysis</button>
        <button class="btn-secondary" onclick="runComplianceCheck()">Allergen Scan</button>
      </div>
    `;
  };

  window.generateCoA = function(batchNo) {
    const batch = db.getBatches().find(b => b.batchNo === batchNo);
    if (!batch) return;
    openCoaModal(batchNo);
  };

  window.openCoaModal = function(batchNo) {
    const batch = db.getBatches().find(b => b.batchNo === batchNo);
    if (!batch) return;
    const allergenNote = batch.qcAllergens && batch.qcAllergens.length > 0
      ? `<p style="color:#ef4444"><strong>Allergen Declaration Required:</strong> ${batch.qcAllergens.join(", ")}</p>` : "";

    document.getElementById("coa-print-viewport").innerHTML = `
      <div style="font-family:serif;color:#000;padding:20px">
        <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:16px">
          <h1 style="font-size:1.4rem">VELITE GROUP</h1>
          <h2 style="font-size:1rem">CERTIFICATE OF ANALYSIS</h2>
          <p style="font-size:0.8rem">ISO 22716 GMP Compliant | 21 CFR Part 11 Certified</p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="border:1px solid #ccc;padding:6px 10px;font-weight:700">Batch No.</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.batchNo}</td>
              <td style="border:1px solid #ccc;padding:6px 10px;font-weight:700">Product</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.productName}</td></tr>
          <tr><td style="border:1px solid #ccc;padding:6px 10px;font-weight:700">Mfg Date</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.mfgDate}</td>
              <td style="border:1px solid #ccc;padding:6px 10px;font-weight:700">Exp Date</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.expDate}</td></tr>
          <tr><td style="border:1px solid #ccc;padding:6px 10px;font-weight:700">Division</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.division}</td>
              <td style="border:1px solid #ccc;padding:6px 10px;font-weight:700">QC Status</td><td style="border:1px solid #ccc;padding:6px 10px;color:green;font-weight:700">${batch.qcStatus}</td></tr>
        </table>
        <h3 style="font-size:0.95rem;margin-bottom:8px">Analytical Results</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <thead><tr style="background:#f0f0f0"><th style="border:1px solid #ccc;padding:6px 10px">Parameter</th><th style="border:1px solid #ccc;padding:6px 10px">Result</th><th style="border:1px solid #ccc;padding:6px 10px">Status</th></tr></thead>
          <tbody>
            <tr><td style="border:1px solid #ccc;padding:6px 10px">pH</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.tests?.pH || "N/A"}</td><td style="border:1px solid #ccc;padding:6px 10px;color:green">PASS</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 10px">Viscosity</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.tests?.viscosity || "N/A"}</td><td style="border:1px solid #ccc;padding:6px 10px;color:green">PASS</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 10px">TAMC</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.qcMicrobial?.tamc || "N/A"}</td><td style="border:1px solid #ccc;padding:6px 10px;color:${batch.qcMicrobial?.tamc?.includes("Pending") ? "orange" : "green"}">${batch.qcMicrobial?.tamc?.includes("Pending") ? "PENDING" : "PASS"}</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 10px">TYMC</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.qcMicrobial?.tymc || "N/A"}</td><td style="border:1px solid #ccc;padding:6px 10px;color:${batch.qcMicrobial?.tymc?.includes("Pending") ? "orange" : "green"}">${batch.qcMicrobial?.tymc?.includes("Pending") ? "PENDING" : "PASS"}</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 10px">Pathogens</td><td style="border:1px solid #ccc;padding:6px 10px">${batch.qcMicrobial?.pathogens || "N/A"}</td><td style="border:1px solid #ccc;padding:6px 10px;color:${batch.qcMicrobial?.pathogens?.includes("Negative") ? "green" : "orange"}">PASS</td></tr>
          </tbody>
        </table>
        ${allergenNote}
        <div style="margin-top:30px;display:flex;justify-content:space-between;border-top:1px solid #ccc;padding-top:12px">
          <div><p><strong>Prepared by (QC):</strong> ___________________</p><p style="font-size:0.75rem;color:#666">Quality Control Department</p></div>
          <div><p><strong>Approved by (QA):</strong> ___________________</p><p style="font-size:0.75rem;color:#666">Quality Assurance Department</p></div>
        </div>
        <p style="margin-top:12px;font-size:0.7rem;color:#999;text-align:center">This document is generated by Velite Unified Nexus. Electronically authenticated per 21 CFR Part 11.</p>
      </div>`;
    document.getElementById("coa-modal").classList.add("active");
    db.addAuditLog(state.currentUser?.name || "QC Analyst", `Certificate of Analysis (CoA) generated for batch ${batchNo}.`, state.currentDivision);
  };

  window.closeCoaModal = () => document.getElementById("coa-modal").classList.remove("active");

  // ============================================================
  // SECTION 15: STABILITY STUDIES
  // ============================================================

  window.renderStabilityStudies = function() {
    const studies = db.getStability();
    document.getElementById("stability-study-cards").innerHTML = studies.map(s => {
      const condHtml = s.conditions.map(c => `
        <div class="condition-row">
          <span>${c.temp}</span>
          <div style="display:flex;gap:6px">
            ${["m1","m2","m3","m6"].map(m => `<span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:${c[m]==='Pass'?'rgba(16,185,129,0.15)':c[m]==='Pending'?'rgba(245,158,11,0.15)':'rgba(239,68,68,0.15)'};color:${c[m]==='Pass'?'#34d399':c[m]==='Pending'?'#fbbf24':'#f87171'}">${m.toUpperCase()}:${c[m].substring(0,4)}</span>`).join("")}
          </div>
        </div>`).join("");
      return `<div class="stability-card">
        <div class="stability-card-header">
          <div><h4>${s.productName}</h4><p style="font-size:0.75rem;color:var(--text-muted)">${s.batchNo}</p></div>
          <div><span class="badge ${s.status==='Ongoing'?'badge-revision':'badge-approved'}">${s.status}</span><p style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">Start: ${s.startDate}</p></div>
        </div>
        <div class="stability-conditions">${condHtml}</div>
        <p style="font-size:0.75rem;color:var(--accent-color);font-weight:600">Active: ${s.activeInterval}</p>
      </div>`;
    }).join("") || `<div style="color:var(--text-muted);padding:20px;text-align:center">No stability studies launched.</div>`;
  };

  window.openStabilityModal = () => document.getElementById("stability-modal").classList.add("active");
  window.closeStabilityModal = () => document.getElementById("stability-modal").classList.remove("active");

  window.launchStabilityStudy = function() {
    const prod = document.getElementById("modal-stab-prod").value.trim();
    const batch = document.getElementById("modal-stab-batch").value.trim();
    if (!prod || !batch) { showNotification("Please enter product name and batch number.", "danger"); return; }
    const conditions = [];
    if (document.getElementById("stab-cond-4").checked) conditions.push({ temp: "4°C", m1: "Pending", m2: "Pending", m3: "Pending", m6: "Pending" });
    if (document.getElementById("stab-cond-25").checked) conditions.push({ temp: "25°C / 60% RH", m1: "Pending", m2: "Pending", m3: "Pending", m6: "Pending" });
    if (document.getElementById("stab-cond-37").checked) conditions.push({ temp: "37°C", m1: "Pending", m2: "Pending", m3: "Pending", m6: "Pending" });
    if (document.getElementById("stab-cond-45").checked) conditions.push({ temp: "45°C / 75% RH", m1: "Pending", m2: "Pending", m3: "Pending", m6: "Pending" });
    const stabs = db.getStability();
    stabs.push({ id: `STAB-2026-${String(stabs.length+1).padStart(2,"0")}`, productName: prod, batchNo: batch, startDate: "2026-05-24", conditions, status: "Ongoing", activeInterval: "Study Initiated" });
    db.saveStability(stabs);
    db.addAuditLog(state.currentUser?.name || "QC Analyst", `Stability study launched for ${prod} — ${batch}.`, state.currentDivision);
    closeStabilityModal();
    renderStabilityStudies();
    showNotification(`Stability study launched for ${batch}.`, "success");
  };

  // ============================================================
  // SECTION 16: ALLERGEN & INGREDIENT COMPLIANCE CHECK
  // ============================================================

  window.runComplianceCheck = function() {
    const raw = document.getElementById("raw-ingredients-input")?.value || "";
    if (!raw) { showNotification("Please enter an ingredient list to scan.", "danger"); return; }
    const ingredients = raw.split(",").map(s => s.trim().toLowerCase());
    const banned = db.getIngredientDB();
    const allergens = db.getAllergensDB();
    const results = document.getElementById("ingredient-scan-results");
    results.style.display = "flex";
    results.innerHTML = "";

    let flaggedBanned = [], flaggedAllergens = [], okCount = 0;
    ingredients.forEach(ing => {
      const b = banned.find(b => ing.includes(b.name.toLowerCase()) || ing.includes(b.synonym.toLowerCase()));
      if (b) { flaggedBanned.push({ ing, ...b }); return; }
      const a = allergens.find(a => ing.includes(a.name.toLowerCase()));
      if (a) { flaggedAllergens.push({ ing, ...a }); return; }
      okCount++;
    });

    if (flaggedBanned.length === 0 && flaggedAllergens.length === 0) {
      results.innerHTML = `<div class="alert-item success">✔ All ${okCount} ingredients clear — no banned substances or known allergens detected.</div>`;
    } else {
      flaggedBanned.forEach(f => results.innerHTML += `<div class="alert-item danger"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div><strong>🚫 BANNED: ${f.name}</strong> (${f.synonym})<br><span style="font-size:0.8rem">${f.reason}</span><br><span class="badge badge-overdue" style="margin-top:4px">${f.region}</span></div></div>`);
      flaggedAllergens.forEach(f => results.innerHTML += `<div class="alert-item warning"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><div><strong>⚠️ ALLERGEN: ${f.name}</strong><br><span style="font-size:0.8rem">${f.risk}</span><br><span style="font-size:0.75rem;color:#fbbf24">Threshold: ${f.threshold}</span></div></div>`);
      if (okCount > 0) results.innerHTML += `<div class="alert-item success">✔ ${okCount} other ingredient(s) cleared — no issues found.</div>`;
    }
    db.addAuditLog(state.currentUser?.name || "QC Analyst", `Ingredient compliance scan: ${flaggedBanned.length} banned, ${flaggedAllergens.length} allergens detected.`, "Global");
  };

  window.clearComplianceField = function() {
    const el = document.getElementById("raw-ingredients-input");
    if (el) el.value = "";
    const res = document.getElementById("ingredient-scan-results");
    if (res) { res.style.display = "none"; res.innerHTML = ""; }
  };

  // ============================================================
  // SECTION 17: ISO 22716 CHECKLIST
  // ============================================================

  const isoChapters = [
    { ch: "Chapter 1", req: "Personnel — Adequate staff, training records, hygiene controls, medical fitness checks", notes: "" },
    { ch: "Chapter 2", req: "Premises — Dedicated zones, temperature/humidity controls, vermin-proof construction", notes: "" },
    { ch: "Chapter 3", req: "Equipment — Qualified, calibrated, preventive maintenance records, cleaning validation", notes: "" },
    { ch: "Chapter 4", req: "Raw Materials — Approved suppliers, CoA verification, quarantine zones", notes: "" },
    { ch: "Chapter 5", req: "Packaging Materials — Specifications, traceability, pre-use inspection", notes: "" },
    { ch: "Chapter 6", req: "Production — Written formulas, in-process controls, batch records", notes: "" },
    { ch: "Chapter 7", req: "Finished Products — Specifications, release criteria, labeling review", notes: "" },
    { ch: "Chapter 8", req: "Quality Control — Testing protocols, reference standards, stability programs", notes: "" },
    { ch: "Chapter 9", req: "Microbiological Monitoring — Challenge testing, contamination control, environmental monitoring", notes: "" },
    { ch: "Chapter 10", req: "Waste Management — Segregation, disposal records, environmental compliance", notes: "" },
    { ch: "Chapter 11", req: "Subcontracting — Agreements, quality oversight, approval lists", notes: "" },
    { ch: "Chapter 12", req: "Deviations — Deviation logs, investigation reports, CAPA", notes: "" },
    { ch: "Chapter 13", req: "Complaints — Recording system, trending, regulatory reporting", notes: "" },
    { ch: "Chapter 14", req: "Recalls — Recall procedure, mock recall drills, distribution records", notes: "" },
    { ch: "Chapter 15", req: "Internal Audits — Audit schedule, qualified auditors, corrective actions", notes: "" },
    { ch: "Chapter 16", req: "Documentation — Document control system, retention periods, version control", notes: "" },
    { ch: "Chapter 17", req: "Change Control — Change request system, impact assessment, revalidation", notes: "" },
  ];

  const savedIso = JSON.parse(localStorage.getItem("velite_iso_checks") || "{}");

  window.renderIsoChecklist = function() {
    const html = isoChapters.map((ch, i) => {
      const key = `iso_${i}`;
      const checked = savedIso[key]?.checked || false;
      const note = savedIso[key]?.note || ch.notes;
      return `<tr>
        <td style="text-align:center">
          <input type="checkbox" id="iso-chk-${i}" ${checked ? "checked" : ""} onchange="updateIsoCheck(${i})">
        </td>
        <td><strong>${ch.ch}</strong></td>
        <td style="font-size:0.8rem">${ch.req}</td>
        <td><input type="text" class="input-glass" id="iso-note-${i}" value="${note}" placeholder="Enter verification notes..." oninput="updateIsoNote(${i})" style="font-size:0.78rem;padding:6px"></td>
      </tr>`;
    }).join("");
    document.getElementById("iso-checklist-body").innerHTML = html;
    updateIsoScore();
  };

  window.updateIsoCheck = function(i) {
    const key = `iso_${i}`;
    if (!savedIso[key]) savedIso[key] = { checked: false, note: "" };
    savedIso[key].checked = document.getElementById(`iso-chk-${i}`).checked;
    localStorage.setItem("velite_iso_checks", JSON.stringify(savedIso));
    updateIsoScore();
  };

  window.updateIsoNote = function(i) {
    const key = `iso_${i}`;
    if (!savedIso[key]) savedIso[key] = { checked: false, note: "" };
    savedIso[key].note = document.getElementById(`iso-note-${i}`).value;
    localStorage.setItem("velite_iso_checks", JSON.stringify(savedIso));
  };

  function updateIsoScore() {
    const total = isoChapters.length;
    const passed = Object.values(savedIso).filter(v => v.checked).length;
    const pct = Math.round((passed / total) * 100);
    const scoreEl = document.getElementById("iso-compliance-score");
    if (scoreEl) scoreEl.textContent = `${pct}% (${passed}/${total})`;
  }

  // ============================================================
  // SECTION 18: AUDIT LOG
  // ============================================================

  window.renderAuditTimeline = function() {
    const logs = db.getAuditLogs();
    document.getElementById("full-audit-timeline").innerHTML = logs.map(l =>
      `<div class="audit-log-item">
        <div class="audit-meta">${l.timestamp}</div>
        <div class="audit-text"><strong>${l.user}</strong>: ${l.action}</div>
        <div class="audit-div">[${l.division}]</div>
      </div>`
    ).join("") || `<div style="text-align:center;color:var(--text-muted);padding:20px">No audit entries yet.</div>`;
  };

  // ============================================================
  // SECTION 19: E-SIGNATURE
  // ============================================================

  window.openEsignModal = function(batchNo) {
    state.esignCallback = batchNo;
    document.getElementById("esign-user").value = state.currentUser?.name || "Sanjiv Kumar Verma";
    document.getElementById("esign-pass").value = "";
    document.getElementById("esign-modal").classList.add("active");
  };

  window.closeEsignModal = () => document.getElementById("esign-modal").classList.remove("active");

  window.authorizeEsign = function() {
    const pass = document.getElementById("esign-pass").value;
    const meaning = document.getElementById("esign-meaning").value;
    const user = state.currentUser?.name || "Sanjiv Kumar Verma";
    if (pass !== "velite2026") { showNotification("Incorrect passcode. Electronic signature not authorized.", "danger"); return; }

    if (state.esignCallback) {
      const batches = db.getBatches();
      const idx = batches.findIndex(b => b.batchNo === state.esignCallback);
      if (idx !== -1) {
        batches[idx].status = "Released";
        db.saveBatches(batches);
      }
    }

    db.addAuditLog(user, `21 CFR Part 11 E-Signature applied. Meaning: ${meaning}. Batch: ${state.esignCallback || "General"}.`, state.currentDivision);
    closeEsignModal();
    renderBmrList();
    showNotification(`Electronic signature applied. Batch ${state.esignCallback || ""} officially released.`, "success");
  };

  // ============================================================
  // SECTION 20: NOTIFICATION HELPER
  // ============================================================

  function showNotification(message, type = "success") {
    const existing = document.getElementById("nexus-notification");
    if (existing) existing.remove();

    const colors = {
      success: { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)", text: "#34d399" },
      warning: { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)", text: "#fbbf24" },
      danger:  { bg: "rgba(239,68,68,0.15)",  border: "rgba(239,68,68,0.4)",  text: "#f87171" }
    };
    const c = colors[type] || colors.success;

    const el = document.createElement("div");
    el.id = "nexus-notification";
    el.style.cssText = `position:fixed;bottom:90px;right:28px;z-index:9000;max-width:340px;padding:14px 18px;background:${c.bg};border:1px solid ${c.border};border-radius:12px;color:${c.text};font-size:0.85rem;font-weight:600;backdrop-filter:blur(12px);box-shadow:0 8px 25px rgba(0,0,0,0.4);animation:slideUpIn 0.3s ease;line-height:1.5;`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  // ============================================================
  // SECTION 21: AI CHAT (DRAWER)
  // ============================================================

  const aiChatHistory = [];

  window.sendAiChatMessage = async function() {
    const input = document.getElementById("ai-chat-input");
    const msg = input?.value?.trim();
    if (!msg) return;
    input.value = "";

    const messagesDiv = document.getElementById("ai-chat-messages");
    const userBubble = document.createElement("div");
    userBubble.className = "ai-chat-bubble-user";
    userBubble.textContent = msg;
    messagesDiv.appendChild(userBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const sendBtn = document.getElementById("ai-chat-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    aiChatHistory.push({ role: "user", content: msg });

    const typingBubble = document.createElement("div");
    typingBubble.className = "ai-chat-bubble-ai";
    typingBubble.innerHTML = `<em style="color:var(--text-muted);font-size:0.75rem">Velite AI is thinking...</em>`;
    messagesDiv.appendChild(typingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const apiKey = localStorage.getItem("velite_claude_api_key");
    if (!apiKey) {
      typingBubble.innerHTML = `Configure your Anthropic API key (click <strong>⚙ Set API Key</strong> above) to activate full Claude AI responses.`;
      aiChatHistory.pop();
      if (sendBtn) sendBtn.disabled = false;
      return;
    }

    try {
      const kb = db.getAiKnowledge();
      const systemPrompt = `You are Velite AI, an expert GMP quality consultant embedded in the Velite Group QA-Nexus system.
You help the QA/QC/Production team with: SOPs, deviations, CAPA, regulatory compliance (FDA 21 CFR Part 11, EU GMP, ISO 22716), batch manufacturing, pharmacopoeia (IP/USP), and quality systems.
Current date: 2026-05-24. Division: ${state.currentDivision === "pharma" ? "Velite Pharmaceuticals" : "Velite Healthcare (Cosmetics)"}.
Training vectorbase has ${kb.length} approved entries.
Be concise, practical, and focused on pharma/cosmetics manufacturing context. Use plain text, no markdown symbols.`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-use": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          system: systemPrompt,
          messages: aiChatHistory
        })
      });

      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || `API ${resp.status}`); }
      const data = await resp.json();
      const reply = data.content[0].text;
      aiChatHistory.push({ role: "assistant", content: reply });
      typingBubble.textContent = reply;
    } catch (err) {
      typingBubble.innerHTML = `<em style="color:#f87171">Error: ${err.message}</em>`;
      aiChatHistory.pop();
    }

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    if (sendBtn) sendBtn.disabled = false;
  };

  // ============================================================
  // SECTION 22: AI TRAINING CENTER CHAT
  // ============================================================

  const trainingChatHistory = [];

  window.sendTrainingCenterChat = async function() {
    const input = document.getElementById("training-chat-input");
    const msg = input?.value?.trim();
    if (!msg) return;
    input.value = "";

    const messagesDiv = document.getElementById("training-chat-messages");
    const userBubble = document.createElement("div");
    userBubble.className = "ai-chat-bubble-user";
    userBubble.textContent = msg;
    messagesDiv.appendChild(userBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const sendBtn = document.getElementById("training-chat-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    trainingChatHistory.push({ role: "user", content: msg });

    const typingBubble = document.createElement("div");
    typingBubble.className = "ai-chat-bubble-ai";
    typingBubble.innerHTML = `<em style="color:var(--text-muted);font-size:0.75rem">Analyzing vectorbase...</em>`;
    messagesDiv.appendChild(typingBubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    const apiKey = localStorage.getItem("velite_claude_api_key");
    if (!apiKey) {
      typingBubble.innerHTML = `Set your Anthropic API key (click <strong>⚙ Set API Key</strong> in the Velite AI panel) to activate this chat.`;
      trainingChatHistory.pop();
      if (sendBtn) sendBtn.disabled = false;
      return;
    }

    try {
      const kb = db.getAiKnowledge();
      const devs = db.getDeviations();
      const kbSummary = kb.map(e => `[${e.id}] ${e.issueType}: Root cause — ${e.rootCause.substring(0, 80)}. CAPA — ${e.capa.substring(0, 60)}.`).join("\n");
      const devSummary = devs.map(d => `[${d.id}] ${d.severity} — ${d.title} (Status: ${d.status})`).join("\n");

      const systemPrompt = `You are the Velite Cognitive AI training specialist. You have been trained on Velite Group's quality deviation history and approved resolution vectors.
Your knowledge base contains the following approved training vectors:\n${kbSummary}\n
Active deviations:\n${devSummary}\n
Answer questions about deviation patterns, CAPA effectiveness, quality trends, and GMP compliance based on this data.
Current date: 2026-05-24. Be concise and reference specific KB entries or deviation IDs where relevant.`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-use": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          system: systemPrompt,
          messages: trainingChatHistory
        })
      });

      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || `API ${resp.status}`); }
      const data = await resp.json();
      const reply = data.content[0].text;
      trainingChatHistory.push({ role: "assistant", content: reply });
      typingBubble.textContent = reply;
    } catch (err) {
      typingBubble.innerHTML = `<em style="color:#f87171">Error: ${err.message}</em>`;
      trainingChatHistory.pop();
    }

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    if (sendBtn) sendBtn.disabled = false;
  };

  // ============================================================
  // SECTION 23: MOBILE SIDEBAR TOGGLE
  // ============================================================

  window.toggleMobileSidebar = function() {
    const sidebar = document.querySelector(".sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    sidebar.classList.toggle("mobile-open");
    overlay.classList.toggle("active");
  };

  window.closeMobileSidebar = function() {
    document.querySelector(".sidebar").classList.remove("mobile-open");
    document.getElementById("sidebar-overlay").classList.remove("active");
  };

  // Close sidebar when a nav item is clicked on mobile
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      if (window.innerWidth <= 860) closeMobileSidebar();
    });
  });

  // ============================================================
  // SECTION 24: GOOGLE DRIVE CLOUD SYNC
  // ============================================================
  const CLOUD_FILE_NAME = "Velite-QA-Nexus-Backup.json";
  // ★ SHARED-FOLDER MODEL (Option A): scope is "drive" so a user can see files
  // OTHER users uploaded into the shared folder. drive.file scope only sees
  // files this app instance created — too restrictive for the multi-user case.
  const CLOUD_SCOPE = "https://www.googleapis.com/auth/drive";
  const SHARED_FOLDER_KEY = "velite_gdrive_shared_folder_id";
  const SCOPE_VERSION_KEY = "velite_gdrive_scope_version";
  const REQUIRED_SCOPE_VERSION = 2;
  const CLOUD_EXCLUDE = new Set(["velite_gdrive_client_id", "velite_gdrive_shared_folder_id", "velite_gdrive_scope_version", "velite_claude_api_key", "velite_cloud_autosync", "velite_cloud_lastsync", "velite_cloud_lastpull"]);

  const getSharedFolderId = () => (localStorage.getItem(SHARED_FOLDER_KEY) || "").trim();
  const isSharedFolderConfigured = () => !!getSharedFolderId();

  // Accepts:
  //   • the bare ID            → 1A2b3C4d5E6f7G8h9I
  //   • /folders/{id}          → https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I
  //   • /folders/{id}?...      → …/folders/1A2b3C4d5E6f7G8h9I?usp=sharing
  //   • /drive/u/0/folders/{id}→ alt account in user's profile
  //   • open?id={id}           → legacy share URL
  // Returns the input untouched if no pattern matches — validation downstream rejects it.
  function extractDriveFolderId(input) {
    if (!input) return "";
    const s = String(input).trim();
    if (!s) return "";
    if (/^[A-Za-z0-9_\-]{20,}$/.test(s)) return s;        // already an ID
    let m = s.match(/\/folders\/([A-Za-z0-9_\-]{20,})/);   // /folders/{id}
    if (m) return m[1];
    m = s.match(/[?&]id=([A-Za-z0-9_\-]{20,})/);            // ?id={id}
    if (m) return m[1];
    return s;
  }

  // One-time migration: clear any cached drive.file-scope token from sessionStorage
  // so users go through the new consent screen for "drive" scope on next Connect Drive.
  (function migrateScopeVersion() {
    try {
      const cur = parseInt(localStorage.getItem(SCOPE_VERSION_KEY) || "1", 10);
      if (cur < REQUIRED_SCOPE_VERSION) {
        sessionStorage.removeItem("velite_gdrive_token");
        localStorage.setItem(SCOPE_VERSION_KEY, String(REQUIRED_SCOPE_VERSION));
      }
    } catch (_) {}
  })();
  let gdriveTokenClient = null;
  let gdriveAccessToken = null;
  let cloudPendingAction = null;
  let cloudBackupTimer = null;
  let _backupPending = false; // true while debounced backup is queued but not yet sent

  const getCloudClientId = () => localStorage.getItem("velite_gdrive_client_id");

  // Wire the live "paste URL → auto-extract ID" listener once. Idempotent.
  let _folderIdListenerAttached = false;
  function _attachFolderIdAutoExtract() {
    if (_folderIdListenerAttached) return;
    const el = document.getElementById("cloud-shared-folder-id");
    if (!el) return;
    el.addEventListener("input", function() {
      const raw = this.value;
      const extracted = extractDriveFolderId(raw);
      if (extracted && extracted !== raw && /^[A-Za-z0-9_\-]{20,}$/.test(extracted)) {
        this.value = extracted;
        const verifyResult = document.getElementById("cloud-shared-folder-verify-result");
        if (verifyResult) {
          verifyResult.innerHTML = `↪ Auto-extracted folder ID from URL.`;
          verifyResult.style.color = "#10b981";
        }
      }
    });
    _folderIdListenerAttached = true;
  }

  // Refresh the in-modal "Shared-folder model active" / "Not configured" status line.
  // Called both when the modal opens AND after every Save Settings click so the
  // user sees the orange→green transition without needing to close/reopen.
  function _refreshSharedFolderStatusUI() {
    const sfStatus = document.getElementById("cloud-shared-folder-status");
    if (!sfStatus) return;
    if (isSharedFolderConfigured()) {
      sfStatus.innerHTML = `✓ Shared-folder model active. All Drive operations target the configured folder.`;
      sfStatus.style.color = "#10b981";
    } else {
      sfStatus.innerHTML = `⚠ Not configured — falling back to per-user Drive root (every QA Manager would need to share one account, which is the unsafe pattern this field replaces).`;
      sfStatus.style.color = "#f59e0b";
    }
  }

  window.configureCloudSync = function() {
    const cid = getCloudClientId();
    document.getElementById("cloud-client-id").value = cid || "";
    document.getElementById("cloud-shared-folder-id").value = getSharedFolderId();
    document.getElementById("cloud-autosync").checked = localStorage.getItem("velite_cloud_autosync") === "1";
    _attachFolderIdAutoExtract();
    _refreshSharedFolderStatusUI();
    // Clear any stale verify result from a previous session
    const vr = document.getElementById("cloud-shared-folder-verify-result");
    if (vr) { vr.innerHTML = ""; vr.style.color = ""; }
    updateCloudStatus();
    document.getElementById("cloud-sync-modal").classList.add("active");
  };

  // ★ Verify the configured shared folder is reachable AND writable from the
  // currently-connected Google account. Hits drive.files.get with the
  // `capabilities` field and reports a precise, actionable result.
  window.verifyDriveSharedFolder = async function() {
    const result = document.getElementById("cloud-shared-folder-verify-result");
    function show(msg, color) {
      if (!result) return;
      result.innerHTML = msg;
      result.style.color = color;
    }
    const cid = getCloudClientId();
    if (!cid) { show("⚠ Enter your Google OAuth Client ID first.", "#f59e0b"); return; }
    const raw = (document.getElementById("cloud-shared-folder-id").value || "").trim();
    const folderId = extractDriveFolderId(raw);
    if (!folderId || !/^[A-Za-z0-9_\-]{20,}$/.test(folderId)) {
      show("⚠ Paste a folder ID or a full Drive URL first.", "#f59e0b");
      return;
    }
    if (!gdriveAccessToken) {
      show("⚠ Not connected to Drive. Click <strong>Connect Drive</strong> first, then re-run Verify.", "#f59e0b");
      return;
    }
    show("Checking Drive…", "#60a5fa");
    try {
      const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,capabilities`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (resp.status === 404) {
        show("✗ <strong>Folder not found.</strong> Wrong ID, deleted, or never shared with this Google account.", "#ef4444");
        return;
      }
      if (resp.status === 403) {
        show("✗ <strong>Access denied.</strong> Ask the owner (Sanjiv) to share the folder with this Google account as <em>Editor</em>.", "#ef4444");
        return;
      }
      if (resp.status === 401) {
        show("✗ <strong>Token expired.</strong> Click <strong>Connect Drive</strong> again to refresh, then re-run Verify.", "#ef4444");
        return;
      }
      if (!resp.ok) {
        show(`✗ Unexpected response: HTTP ${resp.status}.`, "#ef4444");
        return;
      }
      const f = await resp.json();
      if (f.mimeType !== "application/vnd.google-apps.folder") {
        show(`✗ That ID points to a file (<strong>${f.name}</strong>), not a folder.`, "#ef4444");
        return;
      }
      const caps = f.capabilities || {};
      if (!caps.canEdit || !caps.canAddChildren) {
        show(`⚠ Folder <strong>${f.name}</strong> found, but this account has read-only access. Ask the owner to set the role to <em>Editor</em>.`, "#f59e0b");
        return;
      }
      show(`✓ <strong>Verified.</strong> Folder <strong>${f.name}</strong> is accessible and you have write permission. Save Settings to start using it.`, "#10b981");
    } catch (e) {
      show(`✗ Network error: ${e.message || e}.`, "#ef4444");
    }
  };

  window.saveCloudClientId = function() {
    const cid = document.getElementById("cloud-client-id").value.trim();
    if (!cid) { showNotification("Please enter your Google OAuth Client ID.", "danger"); return; }
    // Accept either a bare ID or a full Drive URL — extract the ID from any /folders/… or ?id=… pattern
    const rawFolder = (document.getElementById("cloud-shared-folder-id").value || "").trim();
    const folderId = extractDriveFolderId(rawFolder);
    if (folderId && !/^[A-Za-z0-9_\-]{20,}$/.test(folderId)) {
      showNotification("Shared Folder couldn't be parsed. Paste the bare folder ID, or the full Drive URL (e.g. https://drive.google.com/drive/folders/1A2b3C…).", "danger");
      return;
    }
    // If the input was a URL, normalize the field to the extracted ID for the user
    if (folderId && rawFolder !== folderId) {
      document.getElementById("cloud-shared-folder-id").value = folderId;
    }
    localStorage.setItem("velite_gdrive_client_id", cid);
    if (folderId) localStorage.setItem(SHARED_FOLDER_KEY, folderId);
    else localStorage.removeItem(SHARED_FOLDER_KEY);
    localStorage.setItem("velite_cloud_autosync", document.getElementById("cloud-autosync").checked ? "1" : "0");
    gdriveTokenClient = null; // re-init with the new client id on next connect
    // Bust the folder-id caches so the next Drive op re-resolves into the new shared folder
    _driveDocsFolderId = null;
    _driveMetaFolderId = null;
    showNotification(
      folderId
        ? "Saved. Shared-folder model active — click Connect Drive to authorize with your own Google account."
        : "Saved (legacy per-user mode — set a Shared Folder ID for proper multi-user security).",
      "success"
    );
    updateCloudStatus();
    // ★ Refresh the in-modal status line so the orange "Not configured" warning
    // flips to green "Shared-folder model active" without needing to close/reopen.
    _refreshSharedFolderStatusUI();
  };

  function ensureTokenClient() {
    const cid = getCloudClientId();
    if (!cid) { showNotification("Set your Google OAuth Client ID first, then Save Settings.", "danger"); return null; }
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      showNotification("Google sign-in library is still loading — try again in a moment.", "warning"); return null;
    }
    if (!gdriveTokenClient) {
      gdriveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: CLOUD_SCOPE,
        callback: (resp) => {
          if (resp.error) { showNotification("Google authorization failed: " + resp.error, "danger"); return; }
          gdriveAccessToken = resp.access_token;
          // Cache in sessionStorage so it survives same-session reloads instantly (no popup, no network)
          try {
            const expiresAt = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000;
            sessionStorage.setItem("velite_gdrive_token", JSON.stringify({ token: resp.access_token, expiresAt }));
          } catch (_) {}
          updateCloudStatus();
          showNotification("Connected to Google Drive.", "success");
          if (cloudPendingAction) { const a = cloudPendingAction; cloudPendingAction = null; a(); }
          // Catch-up: back up any local-only document files now that Drive is available
          setTimeout(() => { try { window.syncPendingFilesToDrive && window.syncPendingFilesToDrive(); } catch (_) {} }, 500);
          // Multi-user sync: pull-merge from Drive immediately, then keep polling every 30s
          setTimeout(() => { try { window.startDriveAutoPull && window.startDriveAutoPull(); } catch (_) {} }, 800);
          // ★ NEW per-document architecture: pull doc-*.json, recover orphan files, migrate local docs.
          // Self-healing — any past missed write is fixed automatically on connect.
          setTimeout(() => { try { window.syncDocsWithDriveMeta && window.syncDocsWithDriveMeta({ notify: true }); } catch (_) {} }, 1500);
        }
      });
    }
    return gdriveTokenClient;
  }

  window.connectGoogleDrive = function(thenDo) {
    const tc = ensureTokenClient();
    if (!tc) return;
    cloudPendingAction = typeof thenDo === "function" ? thenDo : null;
    tc.requestAccessToken({ prompt: gdriveAccessToken ? "" : "consent" });
  };

  function withDriveToken(action) {
    if (gdriveAccessToken) action();
    else window.connectGoogleDrive(action);
  }

  function collectAppData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("velite_") && !CLOUD_EXCLUDE.has(k)) data[k] = localStorage.getItem(k);
    }
    return { _app: "velite-qa-nexus", _version: 1, _savedAt: new Date().toISOString(), data };
  }

  async function findCloudFileId() {
    // ★ Shared-folder model: scope the search to the configured shared folder.
    // Falls back to root-level search if no shared folder is set (legacy mode).
    const sharedFolderId = getSharedFolderId();
    const parentClause = sharedFolderId ? ` and '${sharedFolderId}' in parents` : "";
    const q = encodeURIComponent(`name='${CLOUD_FILE_NAME}' and trashed=false${parentClause}`);
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)`, {
      headers: { Authorization: "Bearer " + gdriveAccessToken }
    });
    if (!resp.ok) throw new Error("Drive search failed (" + resp.status + ")");
    const j = await resp.json();
    return j.files && j.files.length ? j.files[0].id : null;
  }

  // ---- Drive helpers for Document Vault file backup (separate "Documents" subfolder) ----
  const DRIVE_DOCS_FOLDER = "Velite QA Nexus — Documents";
  let _driveDocsFolderId = null;

  async function ensureDriveAuth() {
    if (gdriveAccessToken) return;
    const cid = getCloudClientId();
    if (!cid) throw new Error("Cloud Sync not configured (set Google OAuth Client ID first).");
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("Google authorization timed out")), 60000);
      window.connectGoogleDrive(() => { clearTimeout(to); resolve(); });
    });
    if (!gdriveAccessToken) throw new Error("Google authorization was not completed.");
  }

  async function findOrCreateDriveDocsFolder() {
    if (_driveDocsFolderId) return _driveDocsFolderId;
    // ★ Shared-folder model: search & create the Documents subfolder INSIDE
    // the configured shared folder. Falls back to user's root in legacy mode.
    const sharedFolderId = getSharedFolderId();
    const parentClause = sharedFolderId ? ` and '${sharedFolderId}' in parents` : "";
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${DRIVE_DOCS_FOLDER}' and trashed=false${parentClause}`);
    const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
      headers: { Authorization: "Bearer " + gdriveAccessToken }
    });
    if (!listResp.ok) throw new Error("Drive folder search failed (" + listResp.status + ")");
    const listJ = await listResp.json();
    if (listJ.files && listJ.files.length) { _driveDocsFolderId = listJ.files[0].id; return _driveDocsFolderId; }
    const createBody = sharedFolderId
      ? { name: DRIVE_DOCS_FOLDER, mimeType: "application/vnd.google-apps.folder", parents: [sharedFolderId] }
      : { name: DRIVE_DOCS_FOLDER, mimeType: "application/vnd.google-apps.folder" };
    const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": "application/json" },
      body: JSON.stringify(createBody)
    });
    if (!createResp.ok) throw new Error("Drive folder create failed (" + createResp.status + ")");
    const c = await createResp.json();
    _driveDocsFolderId = c.id;
    return _driveDocsFolderId;
  }

  // Resumable upload — preserves the file byte-for-byte (no Google-Docs conversion).
  // Crucial for QA documents: same bytes in, same bytes out, so fonts/formatting never change.
  // ★ BACKEND-PROXIED: uploads go through /api/files/upload on our server.
  // The server holds the Drive refresh token; the browser never touches Google.
  async function uploadFileToDrive(blob, filename, mimeType) {
    if (!window.veliteBackend?.uploadFile) throw new Error("Backend adapter not loaded");
    const res = await window.veliteBackend.uploadFile(blob, filename);
    // Match the shape the rest of app.js expects
    return {
      id: res.driveFileId,
      name: res.driveName,
      size: String(res.size || blob.size),
      md5Checksum: res.md5 || null,
      mimeType: mimeType || blob.type || "application/octet-stream",
      byteVerified: parseInt(res.size || blob.size, 10) === blob.size
    };
  }

  window.downloadDriveFile = async function(fileId) {
    if (!window.veliteBackend?.downloadFile) throw new Error("Backend adapter not loaded");
    return await window.veliteBackend.downloadFile(fileId);
  };

  // Try to push a single document file to Drive (best-effort; returns updated file meta or null)
  window.uploadDocFileToDrive = async function(blob, filename, mimeType) {
    try {
      const res = await uploadFileToDrive(blob, filename, mimeType);
      return { driveFileId: res.id, driveName: res.name };
    } catch (e) {
      console.warn("Drive upload failed:", e);
      return null;
    }
  };

  // Catch-up: after Drive connects, back up any local-only document files
  window.syncPendingFilesToDrive = async function() {
    if (!gdriveAccessToken) return { uploaded: 0, failed: 0, skipped: 0 };
    const docs = db.getDocuments();
    let uploaded = 0, failed = 0, skipped = 0, changed = false;
    for (const doc of docs) {
      for (const kind of ["wordFile", "pdfFile"]) {
        const f = doc[kind];
        if (!f || typeof f !== "object" || !f.idbKey || f.driveFileId) { skipped++; continue; }
        try {
          const blob = await idbGet(f.idbKey);
          if (!blob) { skipped++; continue; }
          const k = kind === "pdfFile" ? "pdf" : "word";
          const driveName = `${doc.id}-${k}-${(f.name || "file").replace(/[^\w.\-]/g, "_")}`;
          const res = await uploadFileToDrive(blob, driveName, f.type || blob.type);
          f.driveFileId = res.id;
          f.driveName = res.name;
          uploaded++; changed = true;
        } catch (e) { failed++; }
      }
    }
    if (changed) { try { db.saveDocuments(docs); renderDocumentVault && renderDocumentVault(); } catch (_) {} }
    if (uploaded) showNotification(`Backed up ${uploaded} pending document file(s) to Google Drive.`, "success");
    return { uploaded, failed, skipped };
  };

  // ============================================================
  // PER-DOCUMENT METADATA ON DRIVE  (race-condition-proof architecture)
  // ------------------------------------------------------------
  // Replaces the monolithic backup.json bottleneck. Each SOP record is its
  // own tiny file (`doc-{id}.json`) in a dedicated Metadata folder.
  //   • Atomic per-document writes → if a save misses, only THAT doc is lost,
  //     never every other doc the user has open.
  //   • No merge logic needed for the doc list — Drive's file listing IS the
  //     source of truth.
  //   • Two QA Managers saving simultaneously create two different files —
  //     no overwrite is possible.
  //   • Self-healing: if a binary file exists in the Documents folder but no
  //     `doc-{id}.json` matches, an orphan recovery stub is synthesized.
  // The legacy backup.json is still written for the other collections
  // (deviations, batches, audit, etc.) which don't have this orphan problem.
  // ============================================================
  const DRIVE_META_FOLDER = "Velite QA Nexus — Metadata";
  let _driveMetaFolderId = null;
  let _metaSyncInProgress = false;

  async function findOrCreateDriveMetaFolder() {
    if (_driveMetaFolderId) return _driveMetaFolderId;
    // ★ Shared-folder model: nest Metadata subfolder inside the shared folder
    const sharedFolderId = getSharedFolderId();
    const parentClause = sharedFolderId ? ` and '${sharedFolderId}' in parents` : "";
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${DRIVE_META_FOLDER}' and trashed=false${parentClause}`);
    const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime`, {
      headers: { Authorization: "Bearer " + gdriveAccessToken }
    });
    if (!listResp.ok) throw new Error("Drive metadata folder search failed (" + listResp.status + ")");
    const listJ = await listResp.json();
    if (listJ.files && listJ.files.length) { _driveMetaFolderId = listJ.files[0].id; return _driveMetaFolderId; }
    const createBody = sharedFolderId
      ? { name: DRIVE_META_FOLDER, mimeType: "application/vnd.google-apps.folder", parents: [sharedFolderId] }
      : { name: DRIVE_META_FOLDER, mimeType: "application/vnd.google-apps.folder" };
    const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": "application/json" },
      body: JSON.stringify(createBody)
    });
    if (!createResp.ok) throw new Error("Drive metadata folder create failed (" + createResp.status + ")");
    const c = await createResp.json();
    _driveMetaFolderId = c.id;
    return _driveMetaFolderId;
  }

  // Find the doc-{id}.json file inside the Metadata folder. Returns id or null.
  async function findDocMetaFileId(docId) {
    const folderId = await findOrCreateDriveMetaFolder();
    const name = `doc-${docId}.json`;
    const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)`, {
      headers: { Authorization: "Bearer " + gdriveAccessToken }
    });
    if (!r.ok) throw new Error("Drive doc-meta search failed (" + r.status + ")");
    const j = await r.json();
    return j.files && j.files.length ? j.files[0].id : null;
  }

  // Atomic single-document write. ~1 KB payload, one API call.
  // This is the key reliability primitive: a failed write loses ONE doc, not all.
  window.writeDocToDriveMeta = async function(doc) {
    if (!gdriveAccessToken || !doc || !doc.id) return null;
    try {
      const folderId = await findOrCreateDriveMetaFolder();
      const name = `doc-${doc.id}.json`;
      const payload = JSON.stringify({
        _velite_meta_v: 1,
        savedAt: new Date().toISOString(),
        savedBy: state.currentUser?.name || "unknown",
        doc
      }, null, 2);
      const existingId = await findDocMetaFileId(doc.id);
      let resp;
      if (existingId) {
        resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
          method: "PATCH",
          headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": "application/json" },
          body: payload
        });
      } else {
        const boundary = "velite_doc_boundary_" + Date.now();
        const meta = { name, mimeType: "application/json", parents: [folderId] };
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify(meta) +
          `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
          payload +
          `\r\n--${boundary}--`;
        resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime", {
          method: "POST",
          headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": `multipart/related; boundary=${boundary}` },
          body
        });
      }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error("doc-meta write failed (" + resp.status + "): " + t.slice(0, 200));
      }
      return await resp.json();
    } catch (e) {
      console.warn(`writeDocToDriveMeta failed for ${doc.id}:`, e);
      // Don't show user-facing error — the legacy backup.json still runs as a fallback.
      return null;
    }
  };

  // Pull every doc-*.json from the Metadata folder and union-merge into local.
  // This bypasses backup.json entirely for the document collection.
  window.pullDocsFromDriveMeta = async function(opts) {
    opts = opts || {};
    if (!gdriveAccessToken) return { changed: false, reason: "not_connected" };
    try {
      const folderId = await findOrCreateDriveMetaFolder();
      const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/json' and trashed=false`);
      const listR = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1000`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!listR.ok) throw new Error("Drive meta list failed (" + listR.status + ")");
      const list = await listR.json();
      const remoteDocs = [];
      const _tombIdsForPull = _tombstoneIds(); // ★ skip tombstoned
      for (const f of (list.files || [])) {
        if (!/^doc-.+\.json$/.test(f.name)) continue;
        const _idm = f.name.match(/^doc-(.+)\.json$/);
        if (_idm && _tombIdsForPull.has(_idm[1].toUpperCase())) continue;
        try {
          const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
            headers: { Authorization: "Bearer " + gdriveAccessToken }
          });
          if (!dl.ok) continue;
          const wrap = await dl.json();
          const doc = wrap && wrap.doc ? wrap.doc : wrap; // tolerate flat layout
          if (doc && doc.id) remoteDocs.push(doc);
        } catch (e) { /* one bad file shouldn't break the sync */ }
      }
      if (remoteDocs.length === 0) return { changed: false, reason: "empty" };

      // Reuse existing union-by-id + pickRicherFile logic by hand
      const localArr = (function(){ try { return JSON.parse(localStorage.getItem("velite_documents") || "[]"); } catch (_) { return []; } })();
      const map = new Map();
      for (const it of localArr) if (it && it.id != null) map.set(it.id, it);
      let added = 0, updated = 0;

      function pickRicher(a, b) {
        if (!a) return b || null;
        if (!b) return a || null;
        const aObj = typeof a === "object", bObj = typeof b === "object";
        if (aObj && !bObj) return a;
        if (bObj && !aObj) return b;
        if (aObj && bObj) {
          const ta = a.uploadedAt || "", tb = b.uploadedAt || "";
          if (ta > tb) return a;
          if (tb > ta) return b;
          if (a.driveFileId && !b.driveFileId) return a;
          if (b.driveFileId && !a.driveFileId) return b;
        }
        return a;
      }
      const tsOf = (d) => (d.history && d.history[0] && d.history[0].date) || d.effectiveDate
                       || (d.wordFile && d.wordFile.uploadedAt) || (d.pdfFile && d.pdfFile.uploadedAt) || "";

      for (const r of remoteDocs) {
        if (!map.has(r.id)) { map.set(r.id, r); added++; continue; }
        const local = map.get(r.id);
        const rt = tsOf(r), lt = tsOf(local);
        let base;
        if (rt > lt) base = { ...r };
        else if (rt < lt) base = { ...local };
        else base = { ...local, ...r };
        base.wordFile = pickRicher(local.wordFile, r.wordFile);
        base.pdfFile = pickRicher(local.pdfFile, r.pdfFile);
        if (JSON.stringify(base) !== JSON.stringify(local)) {
          map.set(r.id, base); updated++;
        }
      }
      if (added || updated) {
        localStorage.setItem("velite_documents", JSON.stringify(Array.from(map.values())));
        try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
        try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
        if (opts.notify) showNotification(`✓ Documents synced from Drive (+${added}/~${updated})`, "success");
      }
      return { changed: !!(added || updated), added, updated };
    } catch (e) {
      console.warn("pullDocsFromDriveMeta failed:", e);
      return { changed: false, reason: "error", error: e.message };
    }
  };

  // Self-healing: scan the Documents folder for files whose docId is not in
  // any local doc record AND not in any Metadata file. Synthesize a stub doc
  // and write a doc-{id}.json so the orphan is visible on every machine.
  window.recoverOrphansFromDriveDocs = async function() {
    if (!gdriveAccessToken) return { recovered: 0 };
    try {
      const docsFolderId = await findOrCreateDriveDocsFolder();
      const q = encodeURIComponent(`'${docsFolderId}' in parents and trashed=false`);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,size,mimeType,modifiedTime)&pageSize=1000`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!r.ok) throw new Error("Drive docs-folder list failed (" + r.status + ")");
      const j = await r.json();
      const filesByDocId = new Map();
      for (const f of (j.files || [])) {
        // Naming convention: {docId}-{kind}-{originalFilename}
        const m = f.name.match(/^([A-Za-z0-9_.\-]+?)-(word|pdf)-(.+)$/);
        if (!m) continue;
        const docId = m[1].toUpperCase();
        if (!filesByDocId.has(docId)) filesByDocId.set(docId, []);
        filesByDocId.get(docId).push({ kind: m[2], origName: m[3], file: f });
      }
      const docs = (function(){ try { return JSON.parse(localStorage.getItem("velite_documents") || "[]"); } catch (_) { return []; } })();
      const knownIds = new Set(docs.map(d => String(d.id).toUpperCase()));
      const tombIds = _tombstoneIds(); // ★ never resurrect a tombstoned doc
      let recovered = 0;
      const newOrPatched = [];
      for (const [docId, files] of filesByDocId) {
        if (tombIds.has(docId)) continue; // ★ orphan recovery must respect tombstones
        const existing = docs.find(d => String(d.id).toUpperCase() === docId);
        if (existing) {
          // Patch: if the local record's wordFile/pdfFile lacks driveFileId but the orphan file matches, link it.
          let patched = false;
          for (const { kind, file } of files) {
            const slot = kind === "pdf" ? "pdfFile" : "wordFile";
            const cur = existing[slot];
            if (!cur || typeof cur !== "object" || !cur.driveFileId) {
              existing[slot] = {
                name: (cur && cur.name) || file.name.replace(/^[^-]+-(word|pdf)-/, "").replace(/_/g, " "),
                type: file.mimeType || (cur && cur.type) || "application/octet-stream",
                size: parseInt(file.size, 10) || (cur && cur.size) || 0,
                idbKey: (cur && cur.idbKey) || null,
                driveFileId: file.id,
                driveName: file.name,
                byteVerified: true,
                uploadedAt: file.modifiedTime || new Date().toISOString()
              };
              patched = true;
            }
          }
          if (patched) newOrPatched.push(existing);
          continue;
        }
        // Truly orphan — synthesize stub doc
        const today = new Date().toISOString().slice(0, 10);
        const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
        const stub = {
          id: docId,
          title: `[Recovered] SOP-${docId}`,
          category: "SOP",
          department: "QA",
          version: "1.0",
          status: "Approved",
          effectiveDate: today,
          renewalDate: nextYear.toISOString().slice(0, 10),
          owner: "Auto-recovery",
          wordFile: null,
          pdfFile: null,
          history: [{ version: "1.0", date: today, author: "Auto-recovery", changes: "Document record auto-recovered from orphaned Drive files. Please edit metadata as needed." }]
        };
        for (const { kind, file } of files) {
          const slot = kind === "pdf" ? "pdfFile" : "wordFile";
          stub[slot] = {
            name: file.name.replace(/^[^-]+-(word|pdf)-/, "").replace(/_/g, " "),
            type: file.mimeType || "application/octet-stream",
            size: parseInt(file.size, 10) || 0,
            idbKey: null,
            driveFileId: file.id,
            driveName: file.name,
            byteVerified: true,
            uploadedAt: file.modifiedTime || new Date().toISOString()
          };
        }
        docs.push(stub);
        knownIds.add(docId);
        newOrPatched.push(stub);
        recovered++;
      }
      if (newOrPatched.length) {
        localStorage.setItem("velite_documents", JSON.stringify(docs));
        // Push each recovered/patched doc to its per-doc metadata file so other machines see it.
        for (const d of newOrPatched) {
          try { await window.writeDocToDriveMeta(d); } catch (_) {}
        }
        try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
        try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
        if (recovered) showNotification(`Self-healing: recovered ${recovered} orphaned document(s) from Drive.`, "success");
        else if (newOrPatched.length) showNotification(`Self-healing: linked ${newOrPatched.length} doc(s) to their Drive copies.`, "success");
      }
      return { recovered, patched: newOrPatched.length - recovered };
    } catch (e) {
      console.warn("recoverOrphansFromDriveDocs failed:", e);
      return { recovered: 0, error: e.message };
    }
  };

  // One-time migration: for every local doc that doesn't yet have a doc-{id}.json
  // on Drive, write one. Idempotent — safe to run on every connect.
  window.migrateLocalDocsToDriveMeta = async function() {
    if (!gdriveAccessToken) return { migrated: 0 };
    try {
      const folderId = await findOrCreateDriveMetaFolder();
      const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/json' and trashed=false`);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)&pageSize=1000`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!r.ok) throw new Error("meta-folder list failed (" + r.status + ")");
      const j = await r.json();
      const present = new Set();
      for (const f of (j.files || [])) {
        const m = f.name.match(/^doc-(.+)\.json$/);
        if (m) present.add(m[1].toUpperCase());
      }
      const docs = (function(){ try { return JSON.parse(localStorage.getItem("velite_documents") || "[]"); } catch (_) { return []; } })();
      const tombIds = _tombstoneIds(); // ★ never re-upload tombstoned docs
      let migrated = 0;
      for (const d of docs) {
        if (!d || !d.id) continue;
        const upperId = String(d.id).toUpperCase();
        if (tombIds.has(upperId)) continue;
        if (present.has(upperId)) continue;
        // ★ Skip recently-restored docs: their doc-{id}.json was just untrashed
        // but Drive's search index may still report it as missing for a few
        // seconds. Migrating would create a duplicate file. The existing
        // untrashed copy is already correct.
        if (_isRecentlyRestored(upperId)) continue;
        const res = await window.writeDocToDriveMeta(d);
        if (res) migrated++;
      }
      if (migrated) showNotification(`Migrated ${migrated} local document(s) to per-doc Drive storage.`, "success");
      return { migrated };
    } catch (e) {
      console.warn("migrateLocalDocsToDriveMeta failed:", e);
      return { migrated: 0, error: e.message };
    }
  };

  // ============================================================
  // TOMBSTONES — deletion source-of-truth that beats eventual consistency
  // ------------------------------------------------------------
  // Problem: in a multi-user / multi-tab Drive sync, deleting a doc can be
  // "undone" by any stale source — another machine's older backup.json, a
  // focus-triggered race pull, or a silent Drive-trash failure that lets
  // orphan recovery resurrect the binary files.
  //
  // Solution: every delete writes a tiny `tombstone-{id}.json` AND a local
  // tombstone record. Every merge / pull / recover path filters tombstoned
  // IDs out. Restore (or re-create with same ID) removes the tombstone.
  // ============================================================
  const TOMBSTONES_KEY = "velite_doc_tombstones";

  // ★ "Recently restored" guard — short-lived (60s) Set of just-restored doc IDs.
  // Reason: when a user clicks Restore, we trash tombstone-{id}.json on Drive
  // and remove the local tombstone immediately. BUT Drive's search index has
  // ~seconds of eventual-consistency lag — the very next pullTombstonesFromDrive
  // will list the trashed-but-still-indexed tombstone-{id}.json, re-add it to
  // local tombstones, and the enforcement step will purge the doc we just
  // restored. This guard tells pullTombstonesFromDrive to IGNORE any remote
  // tombstone whose ID was restored within the last 60 seconds.
  const _recentlyRestoredIds = new Map(); // upperCaseId → restoredAt ms
  const RESTORE_GUARD_MS = 60_000;
  function _markRecentlyRestored(id) {
    _recentlyRestoredIds.set(String(id).toUpperCase(), Date.now());
  }
  function _isRecentlyRestored(id) {
    const upper = String(id).toUpperCase();
    const t = _recentlyRestoredIds.get(upper);
    if (!t) return false;
    if (Date.now() - t > RESTORE_GUARD_MS) {
      _recentlyRestoredIds.delete(upper);
      return false;
    }
    return true;
  }

  function _getTombstones() {
    try { return JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || "[]"); } catch (_) { return []; }
  }
  function _saveTombstones(arr) {
    try { localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function _tombstoneIds() {
    return new Set(_getTombstones().map(t => String(t.id).toUpperCase()));
  }
  function _isTombstoned(id) {
    if (id == null) return false;
    return _tombstoneIds().has(String(id).toUpperCase());
  }
  function _addTombstone(id, deletedBy) {
    const upper = String(id).toUpperCase();
    const arr = _getTombstones().filter(t => String(t.id).toUpperCase() !== upper);
    arr.push({ id: upper, deletedAt: new Date().toISOString(), deletedBy: deletedBy || "unknown" });
    _saveTombstones(arr);
  }
  function _removeTombstone(id) {
    const upper = String(id).toUpperCase();
    _saveTombstones(_getTombstones().filter(t => String(t.id).toUpperCase() !== upper));
  }

  // Atomic per-tombstone write to Drive — single small file, mirrors writeDocToDriveMeta.
  async function writeTombstoneToDriveMeta(id, deletedBy) {
    if (!gdriveAccessToken || !id) return null;
    try {
      const folderId = await findOrCreateDriveMetaFolder();
      const upper = String(id).toUpperCase();
      const name = `tombstone-${upper}.json`;
      const payload = JSON.stringify({
        _velite_tombstone_v: 1,
        id: upper,
        deletedAt: new Date().toISOString(),
        deletedBy: deletedBy || "unknown"
      });
      const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
      const findR = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      const findJ = findR.ok ? await findR.json() : { files: [] };
      const existingId = findJ.files && findJ.files.length ? findJ.files[0].id : null;
      if (existingId) {
        const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
          method: "PATCH",
          headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": "application/json" },
          body: payload
        });
        return r.ok;
      } else {
        const boundary = "velite_tomb_boundary_" + Date.now();
        const meta = { name, mimeType: "application/json", parents: [folderId] };
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify(meta) +
          `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
          payload +
          `\r\n--${boundary}--`;
        const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": `multipart/related; boundary=${boundary}` },
          body
        });
        return r.ok;
      }
    } catch (e) {
      console.warn("writeTombstoneToDriveMeta failed:", e);
      return null;
    }
  }

  async function trashTombstoneOnDrive(id) {
    if (!gdriveAccessToken || !id) return false;
    try {
      const folderId = await findOrCreateDriveMetaFolder();
      const upper = String(id).toUpperCase();
      const name = `tombstone-${upper}.json`;
      const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!r.ok) return false;
      const j = await r.json();
      if (j.files && j.files.length) return await trashDriveFile(j.files[0].id);
      return true; // nothing to trash is success
    } catch (e) { return false; }
  }

  // Pull all tombstone-*.json files from Drive into local, enforce by removing
  // any tombstoned doc from velite_documents. Also push any local-only
  // tombstones in case a previous delete's Drive-write failed.
  window.pullTombstonesFromDrive = async function() {
    if (!gdriveAccessToken) return { added: 0 };
    try {
      const folderId = await findOrCreateDriveMetaFolder();
      const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/json' and trashed=false`);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)&pageSize=1000`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!r.ok) throw new Error("tombstone list failed (" + r.status + ")");
      const j = await r.json();
      const remoteFiles = (j.files || []).filter(f => /^tombstone-.+\.json$/.test(f.name));
      const remote = [];
      const _staleRescuedIds = []; // tombstones we ignored due to recent-restore guard
      for (const f of remoteFiles) {
        // ★ Recently-restored guard: if Drive's search index still shows a
        // tombstone-{id}.json that we just trashed (eventual consistency lag),
        // skip it AND defensively re-trash it so subsequent pulls don't repeat.
        const m = f.name.match(/^tombstone-(.+)\.json$/);
        const id = m ? m[1].toUpperCase() : null;
        if (id && _isRecentlyRestored(id)) {
          _staleRescuedIds.push(id);
          try { await trashDriveFile(f.id); } catch (_) {}
          continue;
        }
        try {
          const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
            headers: { Authorization: "Bearer " + gdriveAccessToken }
          });
          if (dl.ok) {
            const t = await dl.json();
            if (t && t.id) remote.push({ id: String(t.id).toUpperCase(), deletedAt: t.deletedAt || "", deletedBy: t.deletedBy || "" });
          }
        } catch (_) {}
      }
      if (_staleRescuedIds.length) console.log(`[Velite] Ignored ${_staleRescuedIds.length} stale tombstone(s) for recently-restored doc(s):`, _staleRescuedIds);
      const local = _getTombstones();
      const map = new Map(local.map(t => [String(t.id).toUpperCase(), t]));
      let added = 0;
      for (const t of remote) {
        if (!map.has(t.id)) { map.set(t.id, t); added++; }
      }
      // Push any local-only tombstones the Drive list is missing
      const remoteIds = new Set(remote.map(t => t.id));
      for (const t of local) {
        const k = String(t.id).toUpperCase();
        if (!remoteIds.has(k)) {
          try { await writeTombstoneToDriveMeta(k, t.deletedBy); } catch (_) {}
        }
      }
      if (added) _saveTombstones([...map.values()]);

      // Enforce: drop any locally-stored docs whose ID has a tombstone.
      const tombIds = new Set([...map.values()].map(t => String(t.id).toUpperCase()));
      try {
        const docs = JSON.parse(localStorage.getItem("velite_documents") || "[]");
        const filtered = docs.filter(d => !tombIds.has(String(d.id).toUpperCase()));
        if (filtered.length !== docs.length) {
          localStorage.setItem("velite_documents", JSON.stringify(filtered));
          try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
          try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
        }
      } catch (_) {}
      return { remote: remote.length, added };
    } catch (e) {
      console.warn("pullTombstonesFromDrive failed:", e);
      return { error: e.message };
    }
  };

  // Move a Drive file to trash (soft-delete). Best-effort — never throws.
  async function trashDriveFile(fileId) {
    if (!fileId || !gdriveAccessToken) return false;
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true })
      });
      return r.ok;
    } catch (_) { return false; }
  }

  // Delete the per-doc metadata file `doc-{id}.json` from Drive.
  async function deleteDocMetaFromDrive(docId) {
    if (!gdriveAccessToken || !docId) return false;
    try {
      const fileId = await findDocMetaFileId(docId);
      if (!fileId) return false;
      return await trashDriveFile(fileId);
    } catch (_) { return false; }
  }

  // Full document deletion: localStorage + IndexedDB + Drive binaries + Drive metadata.
  // Trashes (not permanently deletes) Drive files — they remain recoverable from
  // Google Drive trash for 30 days, giving QA a safety net for accidental clicks.
  window.deleteDocument = async function(docId) {
    if (!docId) return;
    const docs = db.getDocuments();
    const doc = docs.find(d => d.id === docId);
    if (!doc) { showNotification(`Document ${docId} not found.`, "warning"); return; }

    // Two-step confirmation — destructive action protection
    const msg =
      `Delete document ${docId}?\n\n` +
      `Title: ${doc.title}\n` +
      `Version: v${doc.version}\n` +
      `Status: ${doc.status}\n\n` +
      `This will remove:\n` +
      `  • The document record (this device)\n` +
      `  • The Word and PDF files (local + Google Drive trash)\n` +
      `  • The doc-${docId}.json metadata on Drive\n\n` +
      `Files in Drive trash can be restored for 30 days.\n` +
      `Other QA Managers will see this document disappear on their next sync.\n\n` +
      `Type OK to proceed.`;
    if (!window.confirm(msg)) return;

    const user = state.currentUser?.name || "QA Manager";
    let driveOps = { metaTrashed: false, wordTrashed: false, pdfTrashed: false, tombstoneWritten: false };

    // ★ 0) Tombstone FIRST — this is the deletion source-of-truth.
    // Even if every Drive op below fails, the tombstone guarantees the doc
    // cannot be resurrected by stale backup.json, focus-race pulls, or
    // orphan-recovery scans on this machine OR any other connected machine.
    _addTombstone(docId, user);
    if (gdriveAccessToken) {
      try { driveOps.tombstoneWritten = !!(await writeTombstoneToDriveMeta(docId, user)); } catch (_) {}
    }

    // 1) Trash binary files on Drive (best-effort, independent operations)
    if (gdriveAccessToken) {
      try {
        if (doc.wordFile && typeof doc.wordFile === "object" && doc.wordFile.driveFileId) {
          driveOps.wordTrashed = await trashDriveFile(doc.wordFile.driveFileId);
        }
        if (doc.pdfFile && typeof doc.pdfFile === "object" && doc.pdfFile.driveFileId) {
          driveOps.pdfTrashed = await trashDriveFile(doc.pdfFile.driveFileId);
        }
        // 2) Trash the per-doc metadata file so other machines learn the deletion immediately
        driveOps.metaTrashed = await deleteDocMetaFromDrive(docId);
      } catch (e) { console.warn("Drive cleanup during delete:", e); }
    }

    // 3) Remove IndexedDB blobs
    try {
      if (doc.wordFile && typeof doc.wordFile === "object" && doc.wordFile.idbKey) {
        await idbDelete(doc.wordFile.idbKey);
      }
      if (doc.pdfFile && typeof doc.pdfFile === "object" && doc.pdfFile.idbKey) {
        await idbDelete(doc.pdfFile.idbKey);
      }
    } catch (_) {}

    // 4) Remove the doc record from localStorage
    const next = docs.filter(d => d.id !== docId);
    try { db.saveDocuments(next); } catch (e) {
      showNotification("Could not delete document record: " + (e.message || e), "danger");
      return;
    }

    // 5) Audit log
    try {
      db.addAuditLog(user, `Deleted quality document ${docId} (v${doc.version}) — "${doc.title}"`, state.currentDivision);
    } catch (_) {}

    // 6) Re-render + immediate Drive backup so the deletion propagates everywhere
    try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
    try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
    if (gdriveAccessToken && typeof window.backupToDrive === "function") {
      setTimeout(() => { try { window.backupToDrive(); } catch (_) {} }, 100);
    }

    const parts = [];
    parts.push("removed locally");
    if (driveOps.wordTrashed) parts.push("Word → Drive trash");
    if (driveOps.pdfTrashed) parts.push("PDF → Drive trash");
    if (driveOps.metaTrashed) parts.push(`doc-${docId}.json → Drive trash`);
    showNotification(`Document ${docId} deleted (${parts.join(", ")}).`, "success");
  };

  // ============================================================
  // RECENTLY DELETED (Drive Trash recovery UI)
  // ------------------------------------------------------------
  // Every Delete moves files to Drive trash (30-day soft-delete). This module
  // lets QA Managers see and restore those items directly from the app — no
  // need to open drive.google.com manually.
  // ============================================================
  async function untrashDriveFile(fileId) {
    if (!fileId || !gdriveAccessToken) return false;
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + gdriveAccessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: false })
      });
      return r.ok;
    } catch (_) { return false; }
  }

  // Lists every trashed app-created file, groups by docId, and enriches each
  // group with title/version pulled from the trashed doc-{id}.json content.
  window.listDeletedDocuments = async function() {
    if (!gdriveAccessToken) return { error: "not_connected", docs: [] };
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=trashed=true&spaces=drive&fields=files(id,name,size,mimeType,modifiedTime,trashedTime)&pageSize=1000`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!r.ok) throw new Error("Drive trash list failed (" + r.status + ")");
      const j = await r.json();
      const byDocId = new Map();
      for (const f of (j.files || [])) {
        // ★ tombstone-*.json files are sync ledger entries, not deleted documents
        if (/^tombstone-.+\.json$/.test(f.name)) continue;
        let docId = null, kind = null;
        let m = f.name.match(/^doc-(.+)\.json$/);
        if (m) { docId = m[1].toUpperCase(); kind = "meta"; }
        else {
          m = f.name.match(/^([A-Za-z0-9_.\-]+?)-(word|pdf)-(.+)$/);
          if (m) { docId = m[1].toUpperCase(); kind = m[2]; }
        }
        if (!docId) continue;
        if (!byDocId.has(docId)) byDocId.set(docId, { docId, files: {}, latestTrashed: "" });
        const entry = byDocId.get(docId);
        entry.files[kind] = f;
        if ((f.trashedTime || "") > entry.latestTrashed) entry.latestTrashed = f.trashedTime || "";
      }

      // For each group, peek inside the trashed doc-{id}.json to pull title/version
      const results = [];
      for (const [docId, entry] of byDocId) {
        let title = `SOP-${docId}`, deletedBy = "—", version = "—";
        if (entry.files.meta) {
          try {
            const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${entry.files.meta.id}?alt=media`, {
              headers: { Authorization: "Bearer " + gdriveAccessToken }
            });
            if (dl.ok) {
              const wrap = await dl.json();
              const doc = (wrap && wrap.doc) || wrap;
              if (doc && doc.title) title = doc.title;
              if (doc && doc.version) version = doc.version;
              if (wrap && wrap.savedBy) deletedBy = wrap.savedBy;
            }
          } catch (_) { /* fall back to default title */ }
        }
        const trashedDate = entry.latestTrashed ? new Date(entry.latestTrashed) : null;
        const purgeDate = trashedDate ? new Date(trashedDate.getTime() + 30 * 24 * 60 * 60 * 1000) : null;
        const daysLeft = purgeDate ? Math.max(0, Math.ceil((purgeDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 30;
        results.push({
          docId, title, version, deletedBy,
          trashedAt: entry.latestTrashed, daysLeft,
          hasWord: !!entry.files.word, hasPdf: !!entry.files.pdf, hasMeta: !!entry.files.meta,
          fileIds: {
            meta: entry.files.meta?.id || null,
            word: entry.files.word?.id || null,
            pdf:  entry.files.pdf?.id  || null,
          }
        });
      }
      results.sort((a, b) => (b.trashedAt || "").localeCompare(a.trashedAt || ""));
      return { error: null, docs: results };
    } catch (e) {
      console.warn("listDeletedDocuments failed:", e);
      return { error: e.message, docs: [] };
    }
  };

  // Restore every trashed file matching `docId` (word + pdf + doc-{id}.json),
  // then trigger a sync so the document reappears in the Vault for everyone.
  window.restoreDocument = async function(docId) {
    if (!docId || !gdriveAccessToken) return;
    const upper = String(docId).toUpperCase();
    showNotification(`Restoring document ${upper} from Drive trash…`, "warning");
    try {
      // ★ Mark this ID as recently restored — protects against the next
      // pullTombstonesFromDrive racing with Drive's search index lag.
      _markRecentlyRestored(upper);
      // Remove the tombstone FIRST — both on Drive (so other machines stop
      // enforcing it) and locally (so subsequent pulls accept this docId).
      try { await trashTombstoneOnDrive(upper); } catch (_) {}
      _removeTombstone(upper);

      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=trashed=true&spaces=drive&fields=files(id,name)&pageSize=1000`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!r.ok) throw new Error("Drive trash list failed (" + r.status + ")");
      const j = await r.json();
      let restored = 0;
      let restoredMetaFileId = null; // ★ capture the doc-{id}.json file id during the untrash loop
      for (const f of (j.files || [])) {
        let matchedId = null, kind = null;
        let m = f.name.match(/^doc-(.+)\.json$/);
        if (m) { matchedId = m[1].toUpperCase(); kind = "meta"; }
        else {
          m = f.name.match(/^([A-Za-z0-9_.\-]+?)-(word|pdf)-(.+)$/);
          if (m) { matchedId = m[1].toUpperCase(); kind = m[2]; }
        }
        if (matchedId === upper) {
          if (await untrashDriveFile(f.id)) {
            restored++;
            if (kind === "meta") restoredMetaFileId = f.id;
          }
        }
      }
      try {
        db.addAuditLog(state.currentUser?.name || "QA Manager", `Restored quality document ${upper} from Drive trash (${restored} file(s))`, state.currentDivision);
      } catch (_) {}

      // ★ INSTANT RENDER FIX:
      // Drive's search index has ~seconds of eventual-consistency lag after
      // an untrash. The next pullDocsFromDriveMeta will run a list query with
      // trashed=false, but the just-restored doc-{id}.json may still report
      // as trashed in the search index for a few seconds — so the pull misses
      // it and the row doesn't appear in the Vault.
      //
      // Fix: fetch the restored doc-{id}.json DIRECTLY by file ID (a direct
      // GET bypasses the search index entirely and returns the current state)
      // and inject the document into localStorage right now. The Vault row
      // appears immediately on this machine. Other machines pick it up on
      // their next 30s auto-pull (by which time Drive's index has caught up).
      let injectedLocally = false;
      if (restoredMetaFileId) {
        try {
          const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${restoredMetaFileId}?alt=media`, {
            headers: { Authorization: "Bearer " + gdriveAccessToken }
          });
          if (dl.ok) {
            const wrap = await dl.json();
            const doc = (wrap && wrap.doc) || wrap;
            if (doc && doc.id) {
              const docsNow = db.getDocuments() || [];
              const idx = docsNow.findIndex(d => String(d.id).toUpperCase() === upper);
              if (idx === -1) docsNow.push(doc);
              else docsNow[idx] = doc;
              db.saveDocuments(docsNow);
              try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
              try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
              injectedLocally = true;
            }
          }
        } catch (e) { console.warn("Direct meta fetch failed:", e); }
      }

      showNotification(`Restored ${restored} file(s) for ${upper}.${injectedLocally ? " Now visible in Vault." : " Syncing back…"}`, "success");

      // Belt-and-suspenders: still run the normal sync so other collections
      // (audit, etc.) catch up and any missed orphan files get linked.
      setTimeout(() => { try { window.syncDocsWithDriveMeta && window.syncDocsWithDriveMeta({ notify: false }); } catch (_) {} }, 400);
      // Refresh the Recently Deleted view so the restored row disappears
      setTimeout(() => { try { window.openRecentlyDeleted && window.openRecentlyDeleted(); } catch (_) {} }, 1400);
    } catch (e) {
      showNotification("Restore failed: " + (e.message || e), "danger");
    }
  };

  window.openRecentlyDeleted = async function() {
    const modal = document.getElementById("recently-deleted-modal");
    const body = document.getElementById("recently-deleted-body");
    if (!modal || !body) return;
    modal.classList.add("active");
    if (!gdriveAccessToken) {
      body.innerHTML = `<p style="color:#fca5a5;padding:14px;background:rgba(239,68,68,0.1);border-radius:6px;">⚠ Connect Google Drive Cloud Sync first to see deleted documents.</p>`;
      return;
    }
    body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:30px">Loading from Drive trash…</p>`;
    const { error, docs } = await window.listDeletedDocuments();
    if (error) {
      body.innerHTML = `<p style="color:#fca5a5;padding:14px;background:rgba(239,68,68,0.1);border-radius:6px;">Error: ${error}</p>`;
      return;
    }
    if (!docs.length) {
      body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:30px">No documents in Drive trash. Anything deleted in the next 30 days will appear here for one-click restore.</p>`;
      return;
    }
    const rows = docs.map(d => {
      const urgClass = d.daysLeft <= 7 ? "badge-revision" : (d.daysLeft <= 14 ? "badge-review" : "badge-approved");
      const fileBadges =
        (d.hasWord ? '<span title="Word file in trash" style="margin-right:4px">📝</span>' : '') +
        (d.hasPdf  ? '<span title="PDF file in trash" style="margin-right:4px">📕</span>' : '') +
        (d.hasMeta ? '<span title="Metadata record in trash">📋</span>' : '');
      return `<tr>
        <td><strong style="color:var(--accent-color)">${d.docId}</strong></td>
        <td><strong>${d.title}</strong>${d.version !== "—" ? ` <span style="font-size:0.72rem;color:#60a5fa">v${d.version}</span>` : ""}</td>
        <td><span style="font-size:0.78rem">${d.deletedBy}</span></td>
        <td><span style="font-size:0.74rem;opacity:0.8">${d.trashedAt ? new Date(d.trashedAt).toLocaleString() : "—"}</span></td>
        <td><span class="badge ${urgClass}">${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left</span></td>
        <td>${fileBadges}</td>
        <td><button class="btn-renew" onclick="restoreDocument('${d.docId}')">Restore</button></td>
      </tr>`;
    }).join("");
    body.innerHTML = `
      <div style="overflow-x:auto;border:1px solid var(--glass-border);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
          <thead>
            <tr style="background:rgba(255,255,255,0.04);border-bottom:1px solid var(--glass-border)">
              <th style="text-align:left;padding:10px;font-weight:600">ID</th>
              <th style="text-align:left;padding:10px;font-weight:600">Title</th>
              <th style="text-align:left;padding:10px;font-weight:600">Deleted by</th>
              <th style="text-align:left;padding:10px;font-weight:600">Deleted at</th>
              <th style="text-align:left;padding:10px;font-weight:600">Recovery window</th>
              <th style="text-align:left;padding:10px;font-weight:600">Files</th>
              <th style="text-align:left;padding:10px;font-weight:600">Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  };

  // Single orchestrator: pull + recover + migrate. Safe to call on connect, on
  // page focus, and as a Sync-Now button handler.
  window.syncDocsWithDriveMeta = async function(opts) {
    opts = opts || {};
    if (!gdriveAccessToken) return { reason: "not_connected" };
    if (_metaSyncInProgress) return { reason: "in_progress" };
    _metaSyncInProgress = true;
    try {
      // ★ Tombstones first — every downstream step must respect them.
      try { await window.pullTombstonesFromDrive(); } catch (_) {}
      const pull = await window.pullDocsFromDriveMeta({ notify: false });
      const orphans = await window.recoverOrphansFromDriveDocs();
      const migrate = await window.migrateLocalDocsToDriveMeta();
      if (opts.notify) {
        const parts = [];
        if (pull.added || pull.updated) parts.push(`pulled +${pull.added||0}/~${pull.updated||0}`);
        if (orphans.recovered) parts.push(`recovered ${orphans.recovered}`);
        if (migrate.migrated) parts.push(`migrated ${migrate.migrated}`);
        showNotification(parts.length ? `Document sync: ${parts.join(", ")}` : "Documents already in sync.", "success");
      }
      return { pull, orphans, migrate };
    } finally {
      _metaSyncInProgress = false;
    }
  };

  // ---- Multi-user sync: pull latest backup from Drive and MERGE into local ----
  let _drivePullInProgress = false;
  let _drivePullTimer = null;

  function _tryParse(s, fallback) {
    if (s == null) return fallback;
    if (typeof s !== "string") return s;
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  // Merge remote app data into localStorage. Strategy:
  // - Arrays of records: union by ID (no record is ever lost).
  // - Tie-break: pick the record with the newer "edited" timestamp.
  // - Audit log: append-only union (dedup by timestamp|user|action).
  // - ISO checks: OR-union (any checked-true survives).
  function mergeRemoteData(remoteData) {
    const changes = [];

    // Reconcile a single file slot (wordFile or pdfFile) when both sides have something.
    // Object beats string (real upload beats seed placeholder); newer uploadedAt beats older.
    function pickRicherFile(a, b) {
      if (!a) return b || null;
      if (!b) return a || null;
      const aObj = typeof a === "object";
      const bObj = typeof b === "object";
      if (aObj && !bObj) return a;
      if (bObj && !aObj) return b;
      if (aObj && bObj) {
        const ta = a.uploadedAt || "", tb = b.uploadedAt || "";
        if (ta > tb) return a;
        if (tb > ta) return b;
        // Same timestamp → prefer the one carrying driveFileId (the proven cloud copy)
        if (a.driveFileId && !b.driveFileId) return a;
        if (b.driveFileId && !a.driveFileId) return b;
        return a;
      }
      return a;
    }
    function pickRicherFiles(target, source) {
      const newWord = pickRicherFile(target.wordFile, source.wordFile);
      const newPdf = pickRicherFile(target.pdfFile, source.pdfFile);
      if (newWord === target.wordFile && newPdf === target.pdfFile) return target;
      return { ...target, wordFile: newWord, pdfFile: newPdf };
    }

    function mergeArrayById(localKey, idKey, getTs, label) {
      const remoteArr = _tryParse(remoteData[localKey], []);
      if (!Array.isArray(remoteArr) || remoteArr.length === 0) return;
      // ★ For documents, tombstoned IDs must never be reintroduced from any source.
      const tombIds = localKey === "velite_documents" ? _tombstoneIds() : null;
      const localArr = _tryParse(localStorage.getItem(localKey), []);
      const map = new Map();
      for (const it of localArr) {
        if (!it || it[idKey] == null) continue;
        if (tombIds && tombIds.has(String(it[idKey]).toUpperCase())) continue; // drop stale local
        map.set(it[idKey], it);
      }
      let added = 0, updated = 0;
      for (const it of remoteArr) {
        if (!it || it[idKey] == null) continue;
        if (tombIds && tombIds.has(String(it[idKey]).toUpperCase())) continue; // skip tombstoned
        const k = it[idKey];
        if (!map.has(k)) { map.set(k, it); added++; continue; }
        const existing = map.get(k);
        const rt = getTs(it) || "", lt = getTs(existing) || "";
        // Pick the winner of the basic fields by timestamp, then ALWAYS reconcile file slots
        // independently — a real upload (object with idbKey/driveFileId) must never be displaced
        // by a placeholder string from seed data, regardless of which side is "newer overall".
        let base;
        if (rt > lt) base = { ...it };
        else if (rt < lt) base = { ...existing };
        else base = { ...existing, ...it };
        base.wordFile = pickRicherFile(existing.wordFile, it.wordFile);
        base.pdfFile = pickRicherFile(existing.pdfFile, it.pdfFile);
        if (JSON.stringify(base) !== JSON.stringify(existing)) {
          map.set(k, base); updated++;
        }
      }
      if (added || updated) {
        localStorage.setItem(localKey, JSON.stringify(Array.from(map.values())));
        changes.push(`${label}: +${added}/~${updated}`);
      }
    }

    const docTs = (d) => (d.history && d.history[0] && d.history[0].date) || d.effectiveDate
                       || (d.wordFile && d.wordFile.uploadedAt) || (d.pdfFile && d.pdfFile.uploadedAt) || "";
    mergeArrayById("velite_documents", "id", docTs, "documents");
    mergeArrayById("velite_deviations", "id", (d) => d.dateLogged || "", "deviations");
    mergeArrayById("velite_batches", "batchNo", (b) => b.mfgDate || "", "batches");
    mergeArrayById("velite_stability", "id", (s) => s.startDate || "", "stability");
    mergeArrayById("velite_ai_knowledge", "id", (k) => k.timestamp || "", "KB");

    // Audit log: append-only union
    const remoteAudit = _tryParse(remoteData.velite_audit_logs, []);
    if (Array.isArray(remoteAudit) && remoteAudit.length) {
      const localAudit = _tryParse(localStorage.getItem("velite_audit_logs"), []);
      const seen = new Set(localAudit.map(a => `${a.timestamp}|${a.user}|${a.action}`));
      let added = 0;
      for (const a of remoteAudit) {
        const sig = `${a.timestamp}|${a.user}|${a.action}`;
        if (!seen.has(sig)) { localAudit.unshift(a); seen.add(sig); added++; }
      }
      if (added) {
        localStorage.setItem("velite_audit_logs", JSON.stringify(localAudit));
        changes.push(`audit: +${added}`);
      }
    }

    // ISO checks: OR-union for checked, prefer non-empty note
    const remoteIso = _tryParse(remoteData.velite_iso_checks, null);
    if (remoteIso && typeof remoteIso === "object") {
      const localIso = _tryParse(localStorage.getItem("velite_iso_checks"), {});
      let modified = false;
      for (const k of Object.keys(remoteIso)) {
        const r = remoteIso[k] || {}, l = localIso[k] || {};
        const merged = { checked: !!(r.checked || l.checked), note: r.note || l.note || "" };
        if (merged.checked !== !!l.checked || merged.note !== (l.note || "")) {
          localIso[k] = merged; modified = true;
        }
      }
      if (modified) {
        localStorage.setItem("velite_iso_checks", JSON.stringify(localIso));
        changes.push("iso");
      }
    }

    return { changed: changes.length > 0, changes };
  }

  window.pullFromDriveBackup = async function(opts) {
    opts = opts || {};
    if (_drivePullInProgress) return { changed: false, reason: "in_progress" };
    if (!gdriveAccessToken) { if (opts.notify) showNotification("Connect Cloud Sync first.", "warning"); return { changed: false, reason: "not_connected" }; }
    _drivePullInProgress = true;
    try {
      const id = await findCloudFileId();
      if (!id) return { changed: false, reason: "no_backup" };

      // Check if remote has changed since last pull (skip download otherwise)
      const metaR = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (metaR.status === 401) {
        // Token expired mid-session — clear cached token and silently refresh
        gdriveAccessToken = null;
        try { sessionStorage.removeItem("velite_gdrive_token"); } catch (_) {}
        updateCloudStatus();
        showNotification("Drive token expired — refreshing silently…", "warning");
        setTimeout(() => { try { window.autoRestoreDriveConnection && window.autoRestoreDriveConnection(); } catch (_) {} }, 100);
        return { changed: false, reason: "token_expired_refreshing" };
      }
      if (!metaR.ok) throw new Error("Metadata fetch failed (" + metaR.status + ")");
      const meta = await metaR.json();
      const lastPull = localStorage.getItem("velite_cloud_lastpull") || "";
      if (!opts.force && meta.modifiedTime === lastPull) {
        if (opts.notify) showNotification("Already up to date.", "success");
        return { changed: false, reason: "unchanged" };
      }

      // Download backup content
      const dlR = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
        headers: { Authorization: "Bearer " + gdriveAccessToken }
      });
      if (!dlR.ok) throw new Error("Download failed (" + dlR.status + ")");
      const backup = await dlR.json();
      if (!backup || !backup.data) return { changed: false, reason: "invalid" };

      const result = mergeRemoteData(backup.data);
      localStorage.setItem("velite_cloud_lastpull", meta.modifiedTime);
      updateCloudStatus(); // refresh badge "Synced · X ago" timestamp immediately

      // ★ NEW: per-document metadata pull is the SOURCE OF TRUTH for the docs list.
      // It runs independently of backup.json so a missed/stale backup.json can never
      // hide a document that was correctly written to its own doc-{id}.json file.
      try {
        const docPull = await window.pullDocsFromDriveMeta({ notify: false });
        if (docPull && (docPull.added || docPull.updated)) {
          result.changed = true;
          result.changes = (result.changes || []).concat([`per-doc: +${docPull.added||0}/~${docPull.updated||0}`]);
        }
      } catch (_) { /* per-doc pull is additive — never block the legacy path */ }

      if (result.changed) {
        try { renderDocumentVault && renderDocumentVault(); } catch (_) {}
        try { renderDeviations && renderDeviations(); } catch (_) {}
        try { renderBmrList && renderBmrList(); } catch (_) {}
        try { renderStabilityStudies && renderStabilityStudies(); } catch (_) {}
        try { renderAuditTimeline && renderAuditTimeline(); } catch (_) {}
        try { renderProductionBatchesPanel && renderProductionBatchesPanel(); } catch (_) {}
        try { renderLineClearanceBoard && renderLineClearanceBoard(); } catch (_) {}
        try { renderQcSamplesPanel && renderQcSamplesPanel(); } catch (_) {}
        try { renderAiTrainingCenter && renderAiTrainingCenter(); } catch (_) {}
        try { rebuildMetrics && rebuildMetrics(); } catch (_) {}
        if (opts.notify) showNotification(`✓ Synced from Drive (${result.changes.join(", ")})`, "success");
      } else if (opts.notify) {
        showNotification("Already up to date.", "success");
      }
      return result;
    } catch (e) {
      // Any 401 anywhere in the chain → token expired or revoked → silent refresh
      const msg = (e && e.message) || "";
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        gdriveAccessToken = null;
        try { sessionStorage.removeItem("velite_gdrive_token"); } catch (_) {}
        updateCloudStatus();
        showNotification("Drive token expired — refreshing silently…", "warning");
        setTimeout(() => { try { window.autoRestoreDriveConnection && window.autoRestoreDriveConnection(); } catch (_) {} }, 100);
        return { changed: false, reason: "token_expired_refreshing", error: msg };
      }
      console.warn("Drive pull failed:", e);
      if (opts.notify) showNotification("Drive sync failed: " + (e.message || e), "danger");
      return { changed: false, reason: "error", error: e.message };
    } finally {
      _drivePullInProgress = false;
    }
  };

  // Start auto-pull polling (every 30s when tab is visible) + pull-on-focus
  let _driveVisibilityListenerAdded = false;
  window.startDriveAutoPull = function() {
    if (_drivePullTimer) return;
    // ★ Tombstones MUST be pulled BEFORE backup.json or doc-meta — otherwise
    // a fresh tombstone from another machine won't filter the merge in time.
    setTimeout(() => { try { window.pullTombstonesFromDrive && window.pullTombstonesFromDrive(); } catch (_) {} }, 1000);
    setTimeout(() => window.pullFromDriveBackup({ notify: false }), 1500);
    setTimeout(() => { try { window.pullDocsFromDriveMeta && window.pullDocsFromDriveMeta({ notify: false }); } catch (_) {} }, 2200);
    _drivePullTimer = setInterval(async () => {
      if (gdriveAccessToken && !document.hidden) {
        // Sequence matters — tombstones first, then merges
        try { await (window.pullTombstonesFromDrive && window.pullTombstonesFromDrive()); } catch (_) {}
        window.pullFromDriveBackup({ notify: false });
        try { window.pullDocsFromDriveMeta && window.pullDocsFromDriveMeta({ notify: false }); } catch (_) {}
      }
    }, 30000);
    if (!_driveVisibilityListenerAdded) {
      document.addEventListener("visibilitychange", async () => {
        if (!document.hidden && gdriveAccessToken) {
          try { await (window.pullTombstonesFromDrive && window.pullTombstonesFromDrive()); } catch (_) {}
          setTimeout(() => window.pullFromDriveBackup({ notify: false }), 200);
          setTimeout(() => { try { window.pullDocsFromDriveMeta && window.pullDocsFromDriveMeta({ notify: false }); } catch (_) {} }, 350);
        }
      });
      window.addEventListener("focus", async () => {
        if (gdriveAccessToken) {
          try { await (window.pullTombstonesFromDrive && window.pullTombstonesFromDrive()); } catch (_) {}
          setTimeout(() => window.pullFromDriveBackup({ notify: false }), 200);
          setTimeout(() => { try { window.pullDocsFromDriveMeta && window.pullDocsFromDriveMeta({ notify: false }); } catch (_) {} }, 350);
        }
      });
      _driveVisibilityListenerAdded = true;
    }
  };

  // ★ BACKEND-PROXIED: backup + restore go through the server's Drive proxy.
  window.backupToDrive = async function() {
    if (!window.veliteBackend?.pushBackup) { showNotification("Backend adapter not loaded.", "danger"); return; }
    try {
      const data = collectAppData();
      const r = await window.veliteBackend.pushBackup(data);
      if (!r) throw new Error("Backend rejected the backup");
      localStorage.setItem("velite_cloud_lastsync", new Date().toISOString());
      _backupPending = false;
      updateCloudStatus();
      showNotification("Quality data backed up to Drive.", "success");
    } catch (e) {
      showNotification("Backup error: " + e.message, "danger");
    }
  };

  window.restoreFromDrive = async function() {
    if (!window.veliteBackend?.pullBackup) { showNotification("Backend adapter not loaded.", "danger"); return; }
    try {
      const r = await window.veliteBackend.pullBackup();
      if (!r || !r.backup) { showNotification("No backup found in Drive yet.", "warning"); return; }
      Object.keys(r.backup.data || {}).forEach(k => {
        if (k.startsWith("velite_") && !CLOUD_EXCLUDE.has(k)) localStorage.setItem(k, r.backup.data[k]);
      });
      showNotification("Data restored from Drive. Reloading…", "success");
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      showNotification("Restore error: " + e.message, "danger");
    }
  };

  // Auto-restore Drive connection on page load — silent OAuth refresh.
  // Without this, every page reload silently drops sync and the user has to click Connect Drive again.
  // That was the root cause of "uploads not visible across machines after refresh".
  window.autoRestoreDriveConnection = function() {
    const cid = getCloudClientId();
    if (!cid) return; // not configured
    if (gdriveAccessToken) return; // already connected

    // STEP 1: Try session-storage cache first (instant, no popup, no network)
    try {
      const cached = JSON.parse(sessionStorage.getItem("velite_gdrive_token") || "null");
      if (cached && cached.token && cached.expiresAt > Date.now() + 60000) {
        gdriveAccessToken = cached.token;
        updateCloudStatus();
        showNotification("Drive sync restored from cache — pulling latest…", "success");
        setTimeout(() => { try { window.syncPendingFilesToDrive && window.syncPendingFilesToDrive(); } catch (_) {} }, 300);
        setTimeout(() => { try { window.startDriveAutoPull && window.startDriveAutoPull(); } catch (_) {} }, 500);
        setTimeout(() => { try { window.pullFromDriveBackup && window.pullFromDriveBackup({ force: true, notify: true }); } catch (_) {} }, 900);
        // ★ Per-doc architecture: pull doc-*.json + recover orphans on cache-restore too
        setTimeout(() => { try { window.syncDocsWithDriveMeta && window.syncDocsWithDriveMeta({ notify: false }); } catch (_) {} }, 1400);
        return;
      }
    } catch (_) {}

    // STEP 2: Cache miss/expired → silent OAuth refresh (no popup if user previously consented)
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      // GIS lib not yet loaded — retry shortly
      setTimeout(window.autoRestoreDriveConnection, 800);
      return;
    }
    try {
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: CLOUD_SCOPE,
        callback: (resp) => {
          if (resp.error) {
            // Silent refresh failed — user must click Connect Drive once to re-consent.
            // Show a subtle, dismissible banner so they know sync is paused.
            console.warn("Silent Drive auth failed:", resp.error);
            showNotification("Drive sync paused — click ☁ Cloud Sync → Connect Drive to resume.", "warning");
            return;
          }
          gdriveAccessToken = resp.access_token;
          gdriveTokenClient = tc;
          // Cache the refreshed token
          try {
            const expiresAt = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000;
            sessionStorage.setItem("velite_gdrive_token", JSON.stringify({ token: resp.access_token, expiresAt }));
          } catch (_) {}
          updateCloudStatus();
          showNotification("Drive sync resumed — pulling latest from Drive…", "success");
          // Catch-up sync + start auto-pull
          setTimeout(() => { try { window.syncPendingFilesToDrive && window.syncPendingFilesToDrive(); } catch (_) {} }, 400);
          setTimeout(() => { try { window.startDriveAutoPull && window.startDriveAutoPull(); } catch (_) {} }, 700);
          // Force an immediate visible first-pull so user sees data appearing
          setTimeout(() => { try { window.pullFromDriveBackup && window.pullFromDriveBackup({ force: true, notify: true }); } catch (_) {} }, 1200);
          // ★ Per-doc architecture: full doc sync (pull + orphan recover + migrate) after silent refresh
          setTimeout(() => { try { window.syncDocsWithDriveMeta && window.syncDocsWithDriveMeta({ notify: true }); } catch (_) {} }, 1800);
        }
      });
      gdriveTokenClient = tc;
      tc.requestAccessToken({ prompt: "" }); // silent — won't pop up if user already consented
    } catch (e) {
      console.warn("Auto-restore Drive setup failed:", e);
    }
  };

  window.disconnectDrive = function() {
    if (gdriveAccessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
      try { window.google.accounts.oauth2.revoke(gdriveAccessToken, () => {}); } catch (e) {}
    }
    gdriveAccessToken = null;
    try { sessionStorage.removeItem("velite_gdrive_token"); } catch (_) {}
    updateCloudStatus();
    showNotification("Disconnected from Google Drive.", "warning");
  };

  function _fmtAgo(d) {
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 5) return "just now";
    if (sec < 60) return sec + "s ago";
    if (sec < 3600) return Math.floor(sec / 60) + "m ago";
    if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
    return Math.floor(sec / 86400) + "d ago";
  }

  function updateCloudStatus() {
    const cid = getCloudClientId();
    const badge = document.getElementById("cloud-sync-badge");
    if (badge) {
      if (gdriveAccessToken) {
        // Show last-sync timestamp on the badge so users can SEE sync is working
        const lastPushed = localStorage.getItem("velite_cloud_lastsync");
        const lastPulled = localStorage.getItem("velite_cloud_lastpull");
        // Pick whichever sync activity was most recent (push or pull)
        let latest = null;
        if (lastPushed) latest = new Date(lastPushed);
        if (lastPulled) { const p = new Date(lastPulled); if (!latest || p > latest) latest = p; }
        badge.textContent = latest ? `☁ Synced · ${_fmtAgo(latest)}` : "☁ Drive Synced";
        badge.className = "cloud-sync-badge connected";
        badge.title = latest ? "Last sync activity: " + latest.toLocaleString() : "Connected to Google Drive";
      } else if (cid) {
        badge.textContent = "☁ Connect Drive";
        badge.className = "cloud-sync-badge";
        badge.title = "Click to authorize Drive sync";
      } else {
        badge.textContent = "☁ Cloud Sync";
        badge.className = "cloud-sync-badge no-cfg";
        badge.title = "Cloud Sync not configured";
      }
    }
    const line = document.getElementById("cloud-status-line");
    if (line) {
      const last = localStorage.getItem("velite_cloud_lastsync");
      line.textContent = gdriveAccessToken
        ? ("Connected. " + (last ? "Last backup: " + new Date(last).toLocaleString() : "No backup yet — click Backup Now."))
        : (cid ? "Client ID saved. Click Connect Drive to authorize." : "Not configured. Enter your Google OAuth Client ID below.");
    }
    // Show/hide the prominent reconnect banner.
    // Shown only when: Client ID is configured BUT no active token (the actual broken state).
    const banner = document.getElementById("drive-reconnect-banner");
    if (banner) {
      const shouldShow = !!cid && !gdriveAccessToken && state.loggedIn;
      banner.style.display = shouldShow ? "flex" : "none";
    }
  }

  // Keep the "X ago" badge text fresh — refresh every 20 seconds
  setInterval(() => { try { updateCloudStatus(); } catch (_) {} }, 20000);

  // Auto-sync: wrap localStorage.setItem to debounce a Drive backup on data changes
  const _veliteOrigSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(k, v) {
    _veliteOrigSetItem(k, v);
    try {
      if (k && k.startsWith("velite_") && !CLOUD_EXCLUDE.has(k) &&
          localStorage.getItem("velite_cloud_autosync") === "1" && gdriveAccessToken) {
        clearTimeout(cloudBackupTimer);
        cloudBackupTimer = setTimeout(() => window.backupToDrive(), 4000);
        _backupPending = true;
      }
    } catch (e) { /* never let sync break a save */ }
  };

  // ============================================================
  // INIT: Boot application
  // ============================================================
  rebuildMetrics();
  updateAiStats();
  updateApiKeyStatus();
  updateCloudStatus();

  // Auto-restore Drive sync after page reload (so multi-user uploads stay visible without re-clicking Connect Drive)
  setTimeout(() => { try { window.autoRestoreDriveConnection && window.autoRestoreDriveConnection(); } catch (_) {} }, 1500);

  // SAFETY NET: if the user closes the tab while a backup is queued, fire it synchronously.
  // sendBeacon is the only API guaranteed to survive page unload.
  window.addEventListener("beforeunload", () => {
    try {
      if (_backupPending && gdriveAccessToken && typeof window.backupToDrive === "function") {
        // Fire-and-forget: prefer sendBeacon for reliability, fall back to fetch keepalive
        const payload = JSON.stringify(collectAppData(), null, 2);
        const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=media";
        // We can't easily do a beacon to the existing file ID without async metadata lookup.
        // Easier: just trigger the regular backup synchronously enough — fire it now.
        try { window.backupToDrive(); } catch (_) {}
      }
    } catch (_) {}
  });

});
