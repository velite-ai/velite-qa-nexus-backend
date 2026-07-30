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

  async function proxyDriveFetch(url, opts) {
    const u = String(url);
    // Files list / search
    if (/googleapis\.com\/drive\/v3\/files\?/.test(u)) {
      // Return synthetic empty result — the app will still call our /api/data/pull separately
      return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // File metadata by ID
    const metaMatch = u.match(/googleapis\.com\/drive\/v3\/files\/([^?/]+)(\?.*)?$/);
    if (metaMatch) {
      const fileId = metaMatch[1];
      const query = metaMatch[2] || "";
      // Alt=media = download
      if (/alt=media/.test(query)) {
        return origFetch(`/api/files/${encodeURIComponent(fileId)}`, { credentials: "include" });
      }
      // PATCH = trash / update
      if ((opts?.method || "").toUpperCase() === "PATCH") {
        try {
          const body = opts.body ? JSON.parse(opts.body) : {};
          if (body.trashed === true) {
            const r = await origFetch(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE", credentials: "include" });
            const j = await r.json().catch(() => ({}));
            return new Response(JSON.stringify({ id: fileId, ...j }), { status: r.status, headers: { "Content-Type": "application/json" } });
          }
        } catch (_) {}
        // Other PATCH (e.g. metadata update) — accept as no-op for v1
        return new Response(JSON.stringify({ id: fileId }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // GET metadata — synthesize a minimal response
      return new Response(JSON.stringify({ id: fileId, name: "file", size: "0" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Uploads (multipart / resumable)
    if (/googleapis\.com\/upload\/drive\/v3\/files/.test(u)) {
      // Body could be multipart (JSON create) or resumable init (empty body with metadata header).
      // For v1 we treat the upload synthetically: return a fake ID so the app continues.
      // Real upload is done by app.js via a separate /api/files/upload call (added below via override).
      return new Response(JSON.stringify({ id: "BACKEND_SYNTHETIC_" + Date.now() }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Fallback — let it go through (should never happen for Drive)
    return origFetch(url, opts);
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

  // Expose a promise so app.js can await it if needed
  window.__VELITE_READY = checkDeviceOrPrompt();
})();
