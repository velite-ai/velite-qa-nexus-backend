// ============================================================
// Email fallback — used when SMS gateway fails
// ============================================================
// Uses Gmail SMTP via a "Google App Password" (not the real Gmail password).
// Owner receives the OTP in their inbox as a safety net.

import nodemailer from "nodemailer";

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) throw new Error("SMTP_USER / SMTP_PASSWORD not configured");
  _transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass }
  });
  return _transporter;
}

export async function sendOtpEmail({ to, otp, deviceContext }) {
  const t = getTransporter();
  const from = process.env.SMTP_USER;
  const subject = `Velite QA Nexus — device access code ${otp}`;
  const text = `A new device is requesting access to Velite QA Nexus.

Access code: ${otp}

Device details:
  Browser: ${deviceContext?.userAgent || "unknown"}
  IP:      ${deviceContext?.ip || "unknown"}
  Time:    ${new Date().toISOString()}

The person requesting access should enter this code within 10 minutes.

If you did not expect this request, ignore this email and revoke the device from the Admin panel.

— Velite QA Nexus`;
  const html = `<p>A new device is requesting access to <strong>Velite QA Nexus</strong>.</p>
<p style="font-size:24px;letter-spacing:6px;font-family:monospace;padding:14px 18px;background:#f1f5f9;border-radius:8px;display:inline-block;"><strong>${otp}</strong></p>
<p><strong>Device details:</strong></p>
<ul>
  <li>Browser: ${deviceContext?.userAgent || "unknown"}</li>
  <li>IP: ${deviceContext?.ip || "unknown"}</li>
  <li>Time: ${new Date().toISOString()}</li>
</ul>
<p>The person requesting access should enter this code within 10 minutes.</p>
<p style="color:#64748b;font-size:0.85em">If you did not expect this request, ignore this email and revoke the device from the Admin panel.</p>
<p style="color:#64748b;font-size:0.85em">— Velite QA Nexus</p>`;
  await t.sendMail({ from, to, subject, text, html });
  return { ok: true };
}
