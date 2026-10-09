// ============================================================
// Who is signed in, right now
// ============================================================
// The server never learned which person was using the app: sign-in is a
// client-side account picker, so the backend only ever saw an anonymous
// device id. This is the missing half — each signed-in browser sends a
// heartbeat naming the account it is using, and the dashboard reads back the
// live list.
//
// Deliberately in memory, not SQLite. This answers "who is on the app right
// now", which is true only for as long as the process is up; a restart should
// forget it, and every open browser re-registers within one heartbeat. The
// durable record of who did what already exists in the audit log.

/** A browser is considered gone after this long without a heartbeat. */
export const SESSION_TTL_MS = 90_000; // three missed 30s beats
/** How often clients are expected to check in. Exposed so the UI can match it. */
export const HEARTBEAT_MS = 30_000;

/** deviceId -> session. One entry per browser, so one person on two machines shows twice. */
const sessions = new Map();

const now = () => Date.now();

function prune(at = now()) {
  for (const [deviceId, s] of sessions) {
    if (at - s.lastSeen > SESSION_TTL_MS) sessions.delete(deviceId);
  }
}

/**
 * Record (or refresh) a signed-in browser.
 *
 * Keyed by device, so the same person on two machines counts twice — that is
 * the question being asked ("how many computers"). `since` survives repeated
 * heartbeats but resets when a different account is picked on that device,
 * because that is a new sign-in rather than the same one continuing.
 */
export function heartbeat({ deviceId, name, email, department, ip } = {}) {
  if (!deviceId) throw new Error("deviceId required");
  const at = now();
  const prev = sessions.get(deviceId);
  const sameAccount = prev && prev.email === (email || null);
  sessions.set(deviceId, {
    deviceId,
    name: name || "Unknown",
    email: email || null,
    department: department || null,
    ip: ip || null,
    since: sameAccount ? prev.since : at,
    lastSeen: at
  });
  prune(at);
  return sessions.get(deviceId);
}

/** Drop a browser immediately, on sign-out or tab close. */
export function signOut(deviceId) {
  const existed = sessions.delete(deviceId);
  prune();
  return existed;
}

/**
 * The live list, newest sign-in first. Expired entries are removed on read, so
 * a browser that was closed without signing out disappears on its own.
 */
export function active(at = now()) {
  prune(at);
  return [...sessions.values()]
    .sort((a, b) => b.since - a.since)
    .map((s) => ({
      deviceId: s.deviceId.slice(0, 8), // enough to tell two machines apart, not the whole token
      name: s.name,
      email: s.email,
      department: s.department,
      since: new Date(s.since).toISOString(),
      lastSeen: new Date(s.lastSeen).toISOString()
    }));
}

/** Live counts for the dashboard tile. */
export function summary(at = now()) {
  const list = active(at);
  return {
    devices: list.length,
    people: new Set(list.map((s) => s.email || s.name)).size,
    sessions: list
  };
}

/** Test seam only — never called by the server. */
export function _reset() {
  sessions.clear();
}
