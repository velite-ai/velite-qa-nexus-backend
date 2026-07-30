// ============================================================
// Velite QA Nexus — Backend Adapter Shim
// ============================================================
// Loaded BEFORE app.js. This shim:
//   1. Runs the device-approval flow (blocks the app if the device isn't approved)
//   2. Fakes the Google Drive OAuth surface so the existing app.js "just works"
//   3. Monkey-patches window.fetch to reroute all Google Drive URLs through the backend
//   4. Provides device-approval + admin-panel UI as its own layer
//
// The existing app.js is entirely unaware that Drive isn't reached directly.
// Everything Drive-related flows through /api/* on this same origin.

(function () {
  const LS_DEVICE_ID = "velite_device_id";

  // --------------------------------------------------------
  // Device identifier — persistent per-browser
  // --------------------------------------------------------
  function getOrMintDeviceId() {
    let id = localStorage.getItem(LS_DEVICE_ID);
    if (id && /^[a-f0-9]{16,}$/i.test(id)) return id;
    // Mint 48-char hex on the client; backend will accept
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    id = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(LS_DEVICE_ID, id);
    return id;
  }
  const DEVICE_ID = getOrMintDeviceId();
  window.__VELITE_DEVICE_ID = DEVICE_ID;

  // --------------------------------------------------------
  // Fake the Google Drive OAuth global BEFORE app.js runs
  // --------------------------------------------------------
  // The old app.js expects window.google.accounts.oauth2 to exist and expects
  // a token to eventually be present. We give it a fake token that all code
  // paths accept. Actual Drive API calls are intercepted by fetch monkey-patch below.
  window.google = window.google || {};
  window.google.accounts = window.google.accounts || {};
  window.google.accounts.oauth2 = window.google.accounts.oauth2 || {
    initTokenClient: (opts) => ({
      requestAccessToken: () => {
        // Immediately fire the callback with a fake token
        setTimeout(() => {
          try { opts.callback({ access_token: "BACKEND_MANAGED", expires_in: 3600 }); } catch (_) {}
        }, 10);
      }
    }),
    revoke: (_, cb) => cb && cb()
  };

  // Pre-populate the sessionStorage token cache so autoRestoreDriveConnection succeeds silently
  try {
    sessionStorage.setItem("velite_gdrive_token", JSON.stringify({
      token: "BACKEND_MANAGED",
      expiresAt: Date.now() + 3600 * 1000
    }));
  } catch (_) {}

  // Pre-populate a fake OAuth client-id so the app doesn't nag about Cloud Sync configuration
  if (!localStorage.getItem("velite_gdrive_client_id")) {
    localStorage.setItem("velite_gdrive_client_id", "backend-managed.apps.googleusercontent.com");
  }
  // Also pre-populate a shared folder id (the backend uses the real one; the frontend just needs "something" truthy)
  if (!localStorage.getItem("velite_gdrive_shared_folder_id")) {
    localStorage.setItem("velite_gdrive_shared_folder_id", "BACKEND_MANAGED");
  }
  // Auto-sync ON so debounced backups fire
  localStorage.setItem("velite_cloud_autosync", "1");

  // --------------------------------------------------------
  // Monkey-patch fetch — intercept every Google Drive call
  // --------------------------------------------------------
  const origFetch = window.fetch.bind(window);

  // Universal Drive fetch interceptor — anything hitting Google Drive gets
  // handled synthetically (or proxied through /api/*) so the browser never
  // needs a real Google token. All the app's legacy sync paths become no-ops.
  async function proxyDriveFetch(url, opts) {
    const u = String(url);
    const method = (opts?.method || "GET").toUpperCase();
    const SYNTHETIC_FOLDER_ID = "BACKEND_SYNTHETIC_FOLDER";

    // 1. File download by ID (GET with alt=media) → real proxy through backend
    const metaMatch = u.match(/googleapis\.com\/drive\/v3\/files\/([^?/]+)(\?.*)?$/);
    if (metaMatch) {
      const fileId = metaMatch[1];
      const query = metaMatch[2] || "";
      if (method === "GET" && /alt=media/.test(query)) {
        return origFetch(`/api/files/${encodeURIComponent(fileId)}`, { credentials: "include" });
      }
      // PATCH with trashed:true → real proxy through backend delete
      if (method === "PATCH") {
        try {
          const body = opts.body ? JSON.parse(opts.body) : {};
          if (body.trashed === true) {
            const r = await origFetch(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE", credentials: "include" });
            const j = await r.json().catch(() => ({}));
            return new Response(JSON.stringify({ id: fileId, ...j }), { status: r.status, headers: { "Content-Type": "application/json" } });
          }
        } catch (_) {}
        return new Response(JSON.stringify({ id: fileId, name: "synthetic" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // GET metadata (no alt=media) → synthetic 200
      return new Response(JSON.stringify({ id: fileId, name: "synthetic", size: "0", mimeType: "application/octet-stream" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 2. Files list / search (GET with query string) → synthetic empty result
    if (method === "GET" && /googleapis\.com\/drive\/v3\/files/.test(u)) {
      return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 3. File/folder CREATE (POST to /drive/v3/files) → synthetic 200 with fake ID
    if (method === "POST" && /googleapis\.com\/drive\/v3\/files/.test(u)) {
      return new Response(JSON.stringify({ id: SYNTHETIC_FOLDER_ID, name: "synthetic", mimeType: "application/vnd.google-apps.folder" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 4. Uploads (multipart / resumable) → synthetic upload success
    if (/googleapis\.com\/upload\/drive\/v3\/files/.test(u)) {
      return new Response(JSON.stringify({ id: "BACKEND_SYNTHETIC_" + Date.now(), name: "synthetic" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 5. Any other Drive call (DELETE, etc.) → synthetic 200
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (/googleapis\.com\/(drive|upload\/drive)/.test(url)) {
      return proxyDriveFetch(url, init);
    }
    // Everything else — pass through normally, adding cookie credentials for same-origin /api/* calls
    if (url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/")) {
      const newInit = { credentials: "include", ...(init || {}) };
      return origFetch(input, newInit);
    }
    return origFetch(input, init);
  };

  // --------------------------------------------------------
  // Real upload/download helpers using the backend
  // --------------------------------------------------------
  window.veliteBackend = {
    uploadFile: async function (blob, filename, docId, kind) {
      const form = new FormData();
      form.append("file", blob, filename);
      form.append("name", filename);
      if (docId) form.append("docId", docId);
      if (kind) form.append("kind", kind);
      const r = await origFetch("/api/files/upload", { method: "POST", body: form, credentials: "include" });
      if (!r.ok) throw new Error("upload failed: HTTP " + r.status);
      return await r.json();
    },
    downloadFile: async function (fileId) {
      const r = await origFetch(`/api/files/${encodeURIComponent(fileId)}`, { credentials: "include" });
      if (!r.ok) throw new Error("download failed: HTTP " + r.status);
      return await r.blob();
    },
    pushBackup: async function (data) {
      const r = await origFetch("/api/data/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        credentials: "include"
      });
      return r.ok ? await r.json() : null;
    },
    pullBackup: async function () {
      const r = await origFetch("/api/data/pull", { credentials: "include" });
      return r.ok ? await r.json() : null;
    },
    pushDocMeta: async function (docId, doc) {
      const r = await origFetch("/api/data/doc-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, doc }),
        credentials: "include"
      });
      return r.ok ? await r.json() : null;
    },
    listDevices: async function () {
      const r = await origFetch("/api/admin/devices", { credentials: "include" });
      return r.ok ? await r.json() : null;
    },
    approveDevice: async function (id) {
      const r = await origFetch(`/api/admin/devices/${id}/approve`, { method: "POST", credentials: "include" });
      return r.ok ? await r.json() : null;
    },
    revokeDevice: async function (id) {
      const r = await origFetch(`/api/admin/devices/${id}/revoke`, { method: "POST", credentials: "include" });
      return r.ok ? await r.json() : null;
    },
    audit: async function () {
      const r = await origFetch("/api/admin/audit", { credentials: "include" });
      return r.ok ? await r.json() : null;
    }
  };

  // --------------------------------------------------------
  // Device approval splash — runs BEFORE app.js mounts
  // --------------------------------------------------------
  async function checkDeviceOrPrompt() {
    // Try session cookie first
    let statusR = await origFetch("/api/device/status", { credentials: "include" });
    let status = statusR.ok ? await statusR.json() : { approved: false };

    if (!status.approved) {
      // Request approval
      const label = `${navigator.platform} · ${navigator.userAgent.slice(0, 60)}`;
      const reqR = await origFetch("/api/device/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: DEVICE_ID, label }),
        credentials: "include"
      });
      const reqJ = reqR.ok ? await reqR.json() : { status: "error", error: `HTTP ${reqR.status}` };
      if (reqJ.status === "approved") {
        return true; // already approved via other path
      }
      await showOtpDialog(reqJ);
    }
    return true;
  }

  function showOtpDialog(reqInfo) {
    return new Promise((resolve) => {
      // Hide the rest of the app while OTP screen is up
      const rootStyle = document.createElement("style");
      rootStyle.id = "velite-otp-css";
      rootStyle.textContent = `
        #velite-otp-overlay {
          position:fixed; inset:0; z-index:99999; background:#0b1220;
          display:flex; align-items:center; justify-content:center; padding:20px;
          font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        }
        #velite-otp-overlay .card {
          background:#1e293b; color:#e2e8f0; border-radius:12px;
          padding:36px 32px; max-width:460px; width:100%;
          border:1px solid rgba(148,163,184,0.2);
          box-shadow:0 20px 40px rgba(0,0,0,0.5);
        }
        #velite-otp-overlay h1 { margin:0 0 6px; font-size:1.4rem; color:#fff; }
        #velite-otp-overlay .sub { color:#94a3b8; font-size:0.92rem; margin-bottom:22px; line-height:1.5; }
        #velite-otp-overlay .code-input {
          width:100%; padding:16px; font-size:1.8rem; letter-spacing:0.6em; text-align:center;
          background:#0f172a; border:1px solid #334155; border-radius:8px; color:#e2e8f0;
          font-family:'SF Mono',Menlo,Consolas,monospace; box-sizing:border-box;
        }
        #velite-otp-overlay .btn {
          margin-top:14px; padding:12px 18px; background:#3b82f6; color:#fff;
          border:none; border-radius:8px; font-size:1rem; cursor:pointer; width:100%;
        }
        #velite-otp-overlay .btn:hover { background:#2563eb; }
        #velite-otp-overlay .btn:disabled { background:#475569; cursor:not-allowed; }
        #velite-otp-overlay .msg { margin-top:14px; padding:12px; border-radius:6px; font-size:0.85rem; }
        #velite-otp-overlay .msg.err { background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.4); color:#fca5a5; }
        #velite-otp-overlay .msg.ok { background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.4); color:#86efac; }
        #velite-otp-overlay .detail { font-size:0.78rem; color:#64748b; margin-top:16px; line-height:1.5; }
      `;
      document.head.appendChild(rootStyle);

      const overlay = document.createElement("div");
      overlay.id = "velite-otp-overlay";
      const via = reqInfo.deliveredVia || "email";
      const parts = [];
      if (reqInfo.maskedMobile) parts.push(`mobile ending ${reqInfo.maskedMobile.slice(-4)}`);
      if (reqInfo.maskedEmail) parts.push(`email ${reqInfo.maskedEmail}`);
      const target = parts.join(" and ") || "owner";
      const contactHint = via.includes("sms")
        ? "Ask the owner to check their WhatsApp / SMS for the code."
        : "Ask the owner to check their inbox for the code (subject starts with \"Velite QA Nexus — device access code\").";
      overlay.innerHTML = `
        <div class="card">
          <h1>🔒 Device approval required</h1>
          <div class="sub">
            This browser hasn't been approved yet. An access code has been sent to the owner (${target}) via <strong>${via}</strong>.
            <br><br>${contactHint}<br>Enter the 6-digit code below to activate this device.
          </div>
          <input class="code-input" id="velite-otp-input" maxlength="6" autocomplete="one-time-code" inputmode="numeric" placeholder="••••••">
          <button class="btn" id="velite-otp-submit">Verify & activate</button>
          <div class="msg" id="velite-otp-msg" style="display:none"></div>
          <div class="detail">
            Device ID: <code>${DEVICE_ID.slice(0, 12)}…</code><br>
            The code is valid for 10 minutes. Ask the owner if the SMS hasn't arrived after 30 seconds.
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const input = document.getElementById("velite-otp-input");
      const btn = document.getElementById("velite-otp-submit");
      const msg = document.getElementById("velite-otp-msg");
      input.focus();

      async function submit() {
        const code = input.value.trim();
        if (!/^\d{6}$/.test(code)) {
          msg.className = "msg err"; msg.style.display = "block"; msg.textContent = "Please enter the 6-digit code.";
          return;
        }
        btn.disabled = true; btn.textContent = "Verifying...";
        try {
          const r = await origFetch("/api/device/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: DEVICE_ID, code }),
            credentials: "include"
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) {
            msg.className = "msg err"; msg.style.display = "block";
            const reasons = { wrong_code: "Incorrect code — try again.", expired: "Code expired — refresh the page to request a new one.", too_many_attempts: "Too many attempts — refresh the page.", no_otp: "No pending code — refresh to request one." };
            msg.textContent = reasons[j.error] || `Verification failed: ${j.error || r.status}`;
            btn.disabled = false; btn.textContent = "Verify & activate";
            return;
          }
          msg.className = "msg ok"; msg.style.display = "block"; msg.textContent = "✓ Device approved. Loading app...";
          setTimeout(() => {
            overlay.remove(); rootStyle.remove(); resolve(true);
          }, 700);
        } catch (e) {
          msg.className = "msg err"; msg.style.display = "block"; msg.textContent = "Network error: " + e.message;
          btn.disabled = false; btn.textContent = "Verify & activate";
        }
      }
      btn.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    });
  }

  // --------------------------------------------------------
  // Pull Drive data into localStorage on boot
  // --------------------------------------------------------
  // Runs AFTER device approval but BEFORE app.js's DOMContentLoaded handler.
  // This is what makes the new domain (qa.velite.in) show the existing SOPs
  // that live in Drive's backup.json. Uses the original localStorage.setItem
  // (before app.js wraps it) so hydration doesn't trigger a backup push loop.
  async function pullAndHydrateFromDrive() {
    try {
      const pull = await window.veliteBackend.pullBackup();
      if (!pull || !pull.backup || !pull.backup.data) return { changed: false, reason: "no_backup" };
      let changed = 0;
      for (const [k, v] of Object.entries(pull.backup.data)) {
        if (!k.startsWith("velite_")) continue;
        const cur = localStorage.getItem(k);
        if (cur !== v) {
          localStorage.setItem(k, v);
          changed++;
        }
      }
      // Merge per-doc metadata too (may contain docs newer than backup.json)
      if (Array.isArray(pull.perDocMetadata) && pull.perDocMetadata.length) {
        try {
          const localDocs = JSON.parse(localStorage.getItem("velite_documents") || "[]");
          const byId = new Map();
          for (const d of localDocs) if (d && d.id != null) byId.set(String(d.id).toUpperCase(), d);
          for (const wrap of pull.perDocMetadata) {
            const doc = (wrap && wrap.doc) || wrap;
            if (doc && doc.id != null) byId.set(String(doc.id).toUpperCase(), doc);
          }
          const merged = Array.from(byId.values());
          if (JSON.stringify(merged) !== JSON.stringify(localDocs)) {
            localStorage.setItem("velite_documents", JSON.stringify(merged));
            changed++;
          }
        } catch (_) {}
      }
      // ★ Mark hydration as "OK" only if we got a real backup with real docs.
      // The backup-safety guard in app.js checks this flag before allowing
      // any push to Drive — this prevents mock-seed data from overwriting
      // the real backup when the pull is empty or failed.
      try {
        const docsStr = localStorage.getItem("velite_documents") || "[]";
        const docs = JSON.parse(docsStr);
        if (Array.isArray(docs) && docs.length >= 20) {
          window.__VELITE_HYDRATED_OK = true;
        }
      } catch (_) {}
      console.log(`[Velite] Hydrated ${changed} key(s) from Drive backup. HYDRATED_OK=${!!window.__VELITE_HYDRATED_OK}`);
      return { changed: changed > 0, count: changed };
    } catch (e) {
      console.warn("[Velite] pullAndHydrateFromDrive failed:", e);
      return { changed: false, error: e.message };
    }
  }

  // ★ RECOVERY UTILITY — expose on window for manual recovery from DevTools.
  // If a browser still has the "good" 199 SOPs in localStorage and Drive's backup
  // was corrupted, call this from DevTools console to force-push local data:
  //     window.veliteBackend.forceRestoreToDrive()
  // This bypasses the sanity guard (uses the raw pushBackup) since it's an
  // explicit recovery action, not an automatic write.
  window.veliteBackend.forceRestoreToDrive = async function() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("velite_") && !["velite_gdrive_client_id","velite_gdrive_shared_folder_id","velite_gdrive_scope_version","velite_claude_api_key","velite_cloud_autosync","velite_cloud_lastsync","velite_cloud_lastpull","velite_gdrive_token"].includes(k)) {
        data[k] = localStorage.getItem(k);
      }
    }
    const docsCount = (function(){ try { return JSON.parse(data.velite_documents || "[]").length; } catch (_) { return 0; } })();
    if (!window.confirm(`Force-push ${docsCount} docs (and other velite_* data) from THIS browser's localStorage to Drive?\n\nThis OVERWRITES the current backup.json on Drive. Only do this if you're certain THIS browser has the good, complete data.`)) {
      return { cancelled: true };
    }
    const r = await this.pushBackup(data);
    if (r) alert(`✓ Restored ${docsCount} docs to Drive.`);
    else alert("✗ Restore failed — check console.");
    return r;
  };

  // Continuous background sync — every 60s, quietly pull the latest from Drive
  // and merge. Uses the same primitive that runs on boot.
  function startBackgroundPull() {
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await pullAndHydrateFromDrive();
        if (r.changed) {
          // Trigger a re-render if the app is loaded and exposes the render fn
          try { window.renderDocumentVault && window.renderDocumentVault(); } catch (_) {}
          try { window.rebuildMetrics && window.rebuildMetrics(); } catch (_) {}
        }
      } catch (_) {}
    }, 60_000);
  }

  // Master init: device approval → data hydration → hand off to app.js
  async function initialize() {
    await checkDeviceOrPrompt();
    await pullAndHydrateFromDrive();
    startBackgroundPull();
  }

  // app.js's DOMContentLoaded handler should await this promise before rendering,
  // so it reads a fully-hydrated localStorage.
  window.__VELITE_READY = initialize();
})();
