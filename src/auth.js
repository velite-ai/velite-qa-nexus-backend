// ============================================================
// Device approval + OTP generation
// ============================================================

import crypto from "node:crypto";
import * as db from "./db.js";
import { sendOtpSms } from "./sms.js";
import { sendOtpEmail } from "./mail.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateOtp() {
  // 6-digit numeric OTP; leading zeros preserved
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateDeviceId() {
  return crypto.randomBytes(24).toString("hex"); // 48 hex chars
}

/**
 * Requests approval for a device.
 * - Creates/updates a pending device record
 * - Generates a fresh OTP and delivers it to the owner via SMS (with email fallback)
 * Returns { deliveredVia: 'sms' | 'email' | 'both', maskedTarget } for the UX.
 */
export async function requestDeviceApproval({ deviceId, label, ip, userAgent }) {
  db.upsertPendingDevice({ deviceId, label, ip, userAgent });
  const otp = generateOtp();

  const ownerMobile = process.env.OWNER_MOBILE;
  const ownerEmail = process.env.OWNER_EMAIL;
  const deliveredVia = [];
  let firstError = null;

  // Try SMS first (owner's mobile)
  if (ownerMobile) {
    try {
      await sendOtpSms({ mobile: ownerMobile, otp });
      deliveredVia.push("sms");
    } catch (e) {
      firstError = firstError || e;
      console.warn("[auth] SMS send failed:", e.message);
    }
  }

  // Always send email too (fallback + audit trail)
  if (ownerEmail) {
    try {
      await sendOtpEmail({ to: ownerEmail, otp, deviceContext: { ip, userAgent } });
      deliveredVia.push("email");
    } catch (e) {
      firstError = firstError || e;
      console.warn("[auth] email send failed:", e.message);
    }
  }

  if (deliveredVia.length === 0) {
    // Both channels failed — surface error so admin can investigate.
    // We still save the OTP so admin can manually approve via /api/admin.
    db.saveOtp(deviceId, otp, OTP_TTL_MS, "manual");
    db.audit(null, "otp_delivery_failed", `device=${deviceId} err=${firstError?.message}`);
    throw new Error("OTP could not be delivered via SMS or email. Ask admin to approve manually.");
  }

  db.saveOtp(deviceId, otp, OTP_TTL_MS, deliveredVia.join("+"));
  db.audit(null, "otp_sent", `device=${deviceId} via=${deliveredVia.join("+")}`);

  return {
    deliveredVia: deliveredVia.join("+"),
    maskedMobile: ownerMobile ? maskMobile(ownerMobile) : null,
    maskedEmail: ownerEmail ? maskEmail(ownerEmail) : null,
    ttlSeconds: OTP_TTL_MS / 1000
  };
}

/**
 * Verifies an OTP submitted by a device.
 * On success, marks the device as approved.
 * Returns { ok, reason? }
 */
export function verifyDeviceOtp(deviceId, code) {
  const r = db.verifyOtp(deviceId, code);
  if (!r.ok) {
    db.audit(null, "otp_verify_failed", `device=${deviceId} reason=${r.reason}`);
    return r;
  }
  db.approveDevice(deviceId, "otp");
  db.audit(null, "device_approved", `device=${deviceId} via=otp`);
  return { ok: true };
}

export function isDeviceApproved(deviceId) {
  if (!deviceId) return false;
  const d = db.getDevice(deviceId);
  return !!d && d.status === "approved";
}

// ---- Masking helpers ----
function maskMobile(m) {
  const s = String(m).replace(/\D/g, "");
  if (s.length < 4) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(s.length - 4) + s.slice(-2);
}
function maskEmail(e) {
  const [u, d] = String(e).split("@");
  if (!d) return e;
  const short = u.length <= 2 ? u : u[0] + "*".repeat(Math.max(1, u.length - 2)) + u[u.length - 1];
  return `${short}@${d}`;
}
