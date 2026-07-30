// ============================================================
// MSG91 SMS integration — sends OTP to owner's mobile
// ============================================================
// API doc: https://docs.msg91.com/reference/otp
// Uses the SendOTP endpoint with a pre-registered DLT template.

const MSG91_URL = "https://control.msg91.com/api/v5/otp";

export async function sendOtpSms({ mobile, otp }) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  const senderId = process.env.MSG91_SENDER_ID;
  const countryCode = process.env.OWNER_MOBILE_COUNTRY_CODE || "91";

  if (!authKey) throw new Error("MSG91_AUTH_KEY not configured");
  if (!templateId) throw new Error("MSG91_TEMPLATE_ID not configured (DLT-approved template ID from MSG91)");

  const fullMobile = `${countryCode}${String(mobile).replace(/^0+/, "").replace(/^\+/, "").replace(/\s+/g, "")}`;

  const url = new URL(MSG91_URL);
  url.searchParams.set("template_id", templateId);
  url.searchParams.set("mobile", fullMobile);
  url.searchParams.set("otp", otp);
  if (senderId) url.searchParams.set("sender", senderId);
  url.searchParams.set("otp_expiry", "10"); // minutes

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "authkey": authKey,
      "Content-Type": "application/json",
      "accept": "application/json"
    }
  });

  const txt = await resp.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) {}

  if (!resp.ok || (json && json.type === "error")) {
    const msg = json?.message || txt || `HTTP ${resp.status}`;
    throw new Error(`MSG91 send failed: ${msg}`);
  }
  return { ok: true, requestId: json?.request_id || null, raw: json };
}
