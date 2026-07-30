// ============================================================
// SQLite persistence — devices, OTPs, audit log
// ============================================================
// Uses better-sqlite3 (synchronous, fast, zero-config).
// DB file lives at data/velite.db — mount /app/data as a Coolify Persistent Volume
// so this file survives redeploys.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "data/velite.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    label TEXT,
    ip TEXT,
    user_agent TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','revoked')),
    requested_at INTEGER NOT NULL,
    approved_at INTEGER,
    approved_by TEXT,
    last_seen_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS otps (
    device_id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER DEFAULT 0,
    delivered_via TEXT
  );

  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
`);

// ---- Device operations ----
export function getDevice(deviceId) {
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
}

export function listDevices(status = null) {
  if (status) return db.prepare("SELECT * FROM devices WHERE status = ? ORDER BY requested_at DESC").all(status);
  return db.prepare("SELECT * FROM devices ORDER BY requested_at DESC").all();
}

export function upsertPendingDevice({ deviceId, label, ip, userAgent }) {
  const existing = getDevice(deviceId);
  const now = Date.now();
  if (existing) {
    db.prepare("UPDATE devices SET ip=?, user_agent=?, last_seen_at=? WHERE id=?").run(ip, userAgent, now, deviceId);
    return existing;
  }
  db.prepare(`INSERT INTO devices (id, label, ip, user_agent, status, requested_at, last_seen_at)
              VALUES (?, ?, ?, ?, 'pending', ?, ?)`).run(deviceId, label, ip, userAgent, now, now);
  return getDevice(deviceId);
}

export function approveDevice(deviceId, approvedBy) {
  const now = Date.now();
  const r = db.prepare("UPDATE devices SET status='approved', approved_at=?, approved_by=? WHERE id=?").run(now, approvedBy, deviceId);
  return r.changes > 0;
}

export function revokeDevice(deviceId) {
  const r = db.prepare("UPDATE devices SET status='revoked' WHERE id=?").run(deviceId);
  return r.changes > 0;
}

export function touchDevice(deviceId, ip) {
  db.prepare("UPDATE devices SET last_seen_at=?, ip=? WHERE id=?").run(Date.now(), ip, deviceId);
}

// ---- OTP operations ----
export function saveOtp(deviceId, code, ttlMs, deliveredVia) {
  const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO otps (device_id, code, created_at, expires_at, attempts, delivered_via)
              VALUES (?, ?, ?, ?, 0, ?)`).run(deviceId, code, now, now + ttlMs, deliveredVia);
}

export function verifyOtp(deviceId, code) {
  const row = db.prepare("SELECT * FROM otps WHERE device_id = ?").get(deviceId);
  if (!row) return { ok: false, reason: "no_otp" };
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM otps WHERE device_id = ?").run(deviceId);
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= 5) {
    db.prepare("DELETE FROM otps WHERE device_id = ?").run(deviceId);
    return { ok: false, reason: "too_many_attempts" };
  }
  db.prepare("UPDATE otps SET attempts = attempts + 1 WHERE device_id = ?").run(deviceId);
  if (row.code !== String(code).trim()) return { ok: false, reason: "wrong_code" };
  db.prepare("DELETE FROM otps WHERE device_id = ?").run(deviceId);
  return { ok: true };
}

export function getActiveOtp(deviceId) {
  return db.prepare("SELECT * FROM otps WHERE device_id = ? AND expires_at > ?").get(deviceId, Date.now());
}

// ---- Audit ----
export function audit(actor, action, detail) {
  db.prepare("INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)").run(Date.now(), actor || null, action, detail || null);
}

export function recentAudit(limit = 100) {
  return db.prepare("SELECT * FROM audit ORDER BY ts DESC LIMIT ?").all(limit);
}

// Cleanup expired OTPs every 5 minutes
setInterval(() => {
  try { db.prepare("DELETE FROM otps WHERE expires_at < ?").run(Date.now()); } catch (_) {}
}, 5 * 60 * 1000);

export default db;
