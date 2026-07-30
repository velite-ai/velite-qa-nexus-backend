// ============================================================
// Velite QA Nexus — Backend server
// ============================================================
// Serves the static frontend + provides:
//   - Device approval + OTP verification
//   - Drive proxy (server holds the refresh token; browser never touches Google)
//   - Admin endpoints (approve/revoke devices, backup trigger)
//   - Setup page for generating the initial Drive refresh token

import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as db from "./db.js";
import * as drive from "./drive.js";
import { requestDeviceApproval, verifyDeviceOtp, isDeviceApproved, generateDeviceId } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = parseInt(process.env.PORT || "8080", 10);

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "10mb" }));
app.use(cookieSession({
  name: "velite_session",
  keys: [process.env.SESSION_SECRET || "insecure-dev-secret-change-me"],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production"
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB per file
});

function clientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";
}

// ============================================================
// PUBLIC endpoints (no device approval required)
// ============================================================

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Device requests approval — sends OTP to owner
app.post("/api/device/request", async (req, res) => {
  try {
    const { deviceId: providedId, label } = req.body || {};
    const deviceId = providedId && /^[a-f0-9]{16,}$/i.test(providedId) ? providedId : generateDeviceId();
    const ip = clientIp(req);
    const userAgent = req.headers["user-agent"] || "unknown";

    // If already approved, short-circuit and set session
    if (isDeviceApproved(deviceId)) {
      req.session.deviceId = deviceId;
      db.touchDevice(deviceId, ip);
      return res.json({ deviceId, status: "approved" });
    }

    const info = await requestDeviceApproval({
      deviceId, label: label || null, ip, userAgent
    });
    res.json({ deviceId, status: "pending", ...info });
  } catch (e) {
    console.error("[/api/device/request]", e);
    res.status(500).json({ error: e.message });
  }
});

// Device submits OTP → approved
app.post("/api/device/verify", (req, res) => {
  const { deviceId, code } = req.body || {};
  if (!deviceId || !code) return res.status(400).json({ error: "deviceId and code required" });
  const r = verifyDeviceOtp(deviceId, code);
  if (!r.ok) return res.status(401).json({ error: r.reason });
  req.session.deviceId = deviceId;
  db.touchDevice(deviceId, clientIp(req));
  res.json({ ok: true });
});

// Check current session's device status
app.get("/api/device/status", (req, res) => {
  const deviceId = req.session.deviceId;
  if (!deviceId) return res.json({ approved: false });
  const d = db.getDevice(deviceId);
  if (!d) return res.json({ approved: false });
  if (d.status !== "approved") return res.json({ approved: false, status: d.status });
  db.touchDevice(deviceId, clientIp(req));
  res.json({ approved: true, deviceId, device: { label: d.label } });
});

// ============================================================
// AUTH middleware — for /api/data/* and /api/files/*
// ============================================================
function requireApprovedDevice(req, res, next) {
  const deviceId = req.session.deviceId;
  if (!deviceId || !isDeviceApproved(deviceId)) {
    return res.status(401).json({ error: "device_not_approved" });
  }
  req.deviceId = deviceId;
  next();
}

// ============================================================
// DRIVE PROXY endpoints (require approved device)
// ============================================================

// Pull the backup.json + list of doc-*.json files
app.get("/api/data/pull", requireApprovedDevice, async (req, res) => {
  try {
    const backup = await drive.readJsonFile("Velite-QA-Nexus-Backup.json");
    const docs = await drive.listFolderContents("Velite QA Nexus — Metadata");
    const docFiles = docs.filter(f => /^doc-.+\.json$/.test(f.name));

    // Fetch each doc JSON
    const docContents = [];
    for (const f of docFiles) {
      try {
        const dl = await drive.readJsonFile(f.name);
        if (dl?.data) docContents.push(dl.data);
      } catch (_) {}
    }

    res.json({
      backup: backup?.data || null,
      backupModifiedTime: backup?.modifiedTime || null,
      perDocMetadata: docContents
    });
  } catch (e) {
    console.error("[/api/data/pull]", e);
    res.status(500).json({ error: e.message });
  }
});

// Push a full backup (writes Velite-QA-Nexus-Backup.json)
app.post("/api/data/backup", requireApprovedDevice, async (req, res) => {
  try {
    const payload = req.body?.data;
    if (!payload) return res.status(400).json({ error: "data required" });
    const r = await drive.writeJsonFile("Velite-QA-Nexus-Backup.json", {
      _app: "velite-qa-nexus", _version: 1, _savedAt: new Date().toISOString(),
      _writtenBy: req.deviceId.slice(0, 8),
      data: payload
    });
    db.audit(req.deviceId, "backup_pushed", `bytes=${JSON.stringify(payload).length}`);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error("[/api/data/backup]", e);
    res.status(500).json({ error: e.message });
  }
});

// Push a single per-doc metadata JSON
app.post("/api/data/doc-meta", requireApprovedDevice, async (req, res) => {
  try {
    const { docId, doc } = req.body || {};
    if (!docId || !doc) return res.status(400).json({ error: "docId and doc required" });
    // Ensure Metadata subfolder exists (writeJsonFile writes to root; we need to put doc-{id}.json inside Metadata)
    await drive.listFolderContents("Velite QA Nexus — Metadata"); // ensures folder exists
    // Note: writeJsonFile writes to shared folder root by default. To keep the per-doc files inside the Metadata subfolder,
    // we invoke a specialized version. For simplicity in v1 we write to the shared folder root with the "doc-{id}" prefix.
    // TODO(v2): write into the Metadata subfolder explicitly.
    const r = await drive.writeJsonFile(`doc-${docId}.json`, {
      _velite_meta_v: 1, savedAt: new Date().toISOString(),
      savedBy: req.deviceId.slice(0, 8), doc
    });
    db.audit(req.deviceId, "doc_meta_pushed", `doc=${docId}`);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error("[/api/data/doc-meta]", e);
    res.status(500).json({ error: e.message });
  }
});

// Upload a binary file (Word/PDF)
app.post("/api/files/upload", requireApprovedDevice, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });
    const { name, docId, kind } = req.body || {};
    const safe = (name || req.file.originalname || "file").replace(/[^\w.\-]/g, "_");
    const finalName = (docId && kind) ? `${docId}-${kind}-${safe}` : safe;
    const r = await drive.uploadBinary({
      name: finalName,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });
    db.audit(req.deviceId, "file_uploaded", `name=${finalName} size=${req.file.size}`);
    res.json({ ok: true, driveFileId: r.id, driveName: r.name, size: r.size, md5: r.md5Checksum });
  } catch (e) {
    console.error("[/api/files/upload]", e);
    res.status(500).json({ error: e.message });
  }
});

// Download a binary file
app.get("/api/files/:fileId", requireApprovedDevice, async (req, res) => {
  try {
    const { stream, meta } = await drive.streamBinary(req.params.fileId);
    res.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${(meta.name || "file").replace(/"/g, "")}"`);
    stream.on("error", (e) => { console.error("[stream]", e); try { res.end(); } catch (_) {} });
    stream.pipe(res);
  } catch (e) {
    console.error("[/api/files/:id]", e);
    res.status(500).json({ error: e.message });
  }
});

// Trash a file
app.delete("/api/files/:fileId", requireApprovedDevice, async (req, res) => {
  try {
    await drive.trashFile(req.params.fileId);
    db.audit(req.deviceId, "file_trashed", `id=${req.params.fileId}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ADMIN endpoints (require approved device with is_admin flag OR simple bearer)
// ============================================================
// For v1 simplicity, any approved device can hit these; UI hides them from non-admins.
// (Add role gating later once needed.)

app.get("/api/admin/devices", requireApprovedDevice, (req, res) => {
  res.json({ devices: db.listDevices() });
});

app.post("/api/admin/devices/:id/approve", requireApprovedDevice, (req, res) => {
  const ok = db.approveDevice(req.params.id, `admin:${req.deviceId.slice(0, 8)}`);
  if (ok) db.audit(req.deviceId, "device_approved", `target=${req.params.id} via=admin_ui`);
  res.json({ ok });
});

app.post("/api/admin/devices/:id/revoke", requireApprovedDevice, (req, res) => {
  const ok = db.revokeDevice(req.params.id);
  if (ok) db.audit(req.deviceId, "device_revoked", `target=${req.params.id}`);
  res.json({ ok });
});

app.get("/api/admin/audit", requireApprovedDevice, (req, res) => {
  res.json({ audit: db.recentAudit(200) });
});

app.get("/api/admin/drive-test", requireApprovedDevice, async (req, res) => {
  const r = await drive.testConnection();
  res.json(r);
});

// ============================================================
// SETUP flow — one-time Google OAuth to generate refresh token
// ============================================================
// This flow runs the standard Google "Authorization Code" grant:
// 1. GET /setup/start → redirects to Google's consent screen
// 2. Google → GET /setup/callback?code=... → server exchanges for refresh_token
// 3. Page displays the refresh_token for owner to paste into Coolify env vars.

app.get("/setup/start", (req, res) => {
  try {
    const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const redirectUri = `${publicUrl.replace(/\/$/, "")}/setup/callback`;
    const oauth = drive.getSetupOAuthClient(redirectUri);
    const url = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/drive"]
    });
    res.redirect(url);
  } catch (e) {
    res.status(500).send(`<pre>Setup start failed: ${e.message}\n\nMake sure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in Coolify env vars.</pre>`);
  }
});

app.get("/setup/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) throw new Error("No 'code' in query");
    const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const redirectUri = `${publicUrl.replace(/\/$/, "")}/setup/callback`;
    const oauth = drive.getSetupOAuthClient(redirectUri);
    const { tokens } = await oauth.getToken(code);
    const rt = tokens.refresh_token;
    if (!rt) throw new Error("No refresh_token returned. Try again — remove app access at https://myaccount.google.com/permissions and re-run /setup/start.");
    res.send(`<!doctype html><html><head><title>Refresh token generated</title>
<style>body{font-family:system-ui;max-width:720px;margin:40px auto;padding:20px;background:#0b1220;color:#e2e8f0}
h1{color:#22c55e}code{background:#1f2937;padding:2px 6px;border-radius:4px}pre{background:#1f2937;padding:14px;border-radius:8px;white-space:pre-wrap;word-break:break-all}
.warn{background:#7c2d12;border:1px solid #f97316;padding:12px;border-radius:6px;margin:14px 0}</style></head>
<body>
<h1>✓ Refresh token generated</h1>
<p>Copy the token below and paste it into Coolify → your app → <strong>Environment Variables</strong> → set <code>GOOGLE_REFRESH_TOKEN</code>.</p>
<pre>${rt}</pre>
<div class="warn">
  <strong>Then:</strong>
  <ol>
    <li>Click <strong>Save</strong> in Coolify</li>
    <li>Click <strong>Redeploy</strong> so the new env var takes effect</li>
    <li>Delete or protect this <code>/setup/*</code> route once done — anyone who visits could generate a new token</li>
  </ol>
</div>
<p>Once the refresh token is saved, this whole app can operate without any per-user Google login. Team members just open the URL and click their name — no Google prompts ever.</p>
</body></html>`);
  } catch (e) {
    res.status(500).send(`<pre>Setup callback failed: ${e.message}</pre>`);
  }
});

// ============================================================
// STATIC frontend
// ============================================================
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// Fallback to index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`[velite-qa-nexus] listening on :${PORT}`);
  console.log(`[velite-qa-nexus] PUBLIC_URL=${process.env.PUBLIC_URL || "not set"}`);
  console.log(`[velite-qa-nexus] refresh token: ${process.env.GOOGLE_REFRESH_TOKEN ? "SET" : "NOT SET — visit /setup/start once to generate"}`);
});
