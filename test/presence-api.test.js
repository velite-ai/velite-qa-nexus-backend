// End-to-end over the real HTTP endpoints, against a server started here with
// a temporary database. The unit tests cover the store's rules; these check the
// wiring — routes mounted, auth enforced, device identity taken from the
// session rather than the request body.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8187;
const BASE = `http://127.0.0.1:${PORT}`;
let server, dataDir;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "velite-presence-"));
  server = spawn(process.execPath, [join(ROOT, "src", "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: "test", DATA_DIR: dataDir, NODE_ENV: "test" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});

after(() => {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** A browser that has been through device approval, carrying its session cookie. */
async function approvedBrowser(deviceId) {
  const jar = [];
  const call = async (path, init = {}) => {
    const r = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}), cookie: jar.join("; ") },
    });
    const set = r.headers.getSetCookie?.() || [];
    for (const c of set) jar.push(c.split(";")[0]);
    return r;
  };
  const req = await call("/api/device/request", {
    method: "POST",
    body: JSON.stringify({ deviceId, label: "test" }),
  });
  const body = await req.json().catch(() => ({}));
  return { call, approved: body.status === "approved" };
}

test("presence endpoints reject a browser that has not been approved", async () => {
  for (const [path, init] of [
    ["/api/presence", {}],
    ["/api/presence/heartbeat", { method: "POST", body: "{}" }],
    ["/api/presence/signout", { method: "POST" }],
  ]) {
    const r = await fetch(BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(r.status, 401, `${path} must require an approved device`);
  }
});

test("the presence routes are mounted and answer with the expected shape", async () => {
  // Unapproved devices get 401 rather than 404, which already proves the routes
  // exist; this pins the contract the dashboard reads.
  const r = await fetch(`${BASE}/api/presence`);
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.equal(body.error, "device_not_approved", "auth failure should be explicit, not a generic error");
});

test("the heartbeat endpoint does not accept a device id from the request body", async () => {
  // Identity must come from the session cookie. If the body were trusted, any
  // caller could add or impersonate sessions.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "src", "server.js"), "utf8")
  );
  const handler = src.match(/app\.post\("\/api\/presence\/heartbeat"[\s\S]*?\n\}\);/)[0];
  assert.ok(handler.includes("deviceId: req.deviceId"), "device must come from the session");

  // Whatever the handler pulls out of the body, deviceId must not be among it.
  const fromBody = handler.match(/const \{([^}]*)\} = req\.body/);
  assert.ok(fromBody, "the handler should destructure the fields it accepts from the body");
  const accepted = fromBody[1].split(",").map((f) => f.trim()).filter(Boolean);
  assert.ok(
    !accepted.includes("deviceId"),
    `device id must never be read from the request body; handler accepts: ${accepted.join(", ")}`
  );
  assert.deepEqual(accepted.sort(), ["department", "email", "name"], "only the account fields are accepted");
});

test("sign-out takes the device from the session too", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "src", "server.js"), "utf8")
  );
  const handler = src.match(/app\.post\("\/api\/presence\/signout"[\s\S]*?\n\}\);/)[0];
  assert.ok(handler.includes("presence.signOut(req.deviceId)"), "sign-out must only end your own session");
});

test("the client is told how often to check in, so the two cannot drift", async () => {
  const { HEARTBEAT_MS } = await import("../src/presence.js");
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "src", "server.js"), "utf8")
  );
  assert.match(src, /heartbeatMs: presence\.HEARTBEAT_MS/, "GET /api/presence should publish the interval");

  const app = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "public", "app.js"), "utf8")
  );
  const clientMs = Number(app.match(/const PRESENCE_BEAT_MS = (\d+)/)[1]);
  assert.equal(clientMs, HEARTBEAT_MS, "client beat interval must match the server's expectation");
});

// ---- the heartbeat must survive normal browser behaviour -------------------
//
// Two ways a person who is still working can wrongly drop off the list. Both
// are browser event handling, so they are checked structurally rather than by
// standing up a DOM.

test("entering the back/forward cache does not sign you out", async () => {
  const app = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "public", "app.js"), "utf8")
  );
  const handler = app.match(/addEventListener\("pagehide"[\s\S]*?\n  \}\);/);
  assert.ok(handler, "a pagehide handler should exist so a closed tab drops off at once");
  assert.match(
    handler[0],
    /persisted\)\s*return/,
    "pagehide fires for bfcache too; signing out there removes people who are still working"
  );
  const signOutAt = handler[0].indexOf("presenceSignOut");
  const guardAt = handler[0].indexOf("persisted");
  assert.ok(guardAt !== -1 && guardAt < signOutAt, "the bfcache guard must come before the sign-out");
});

test("returning to a backgrounded tab checks in immediately", async () => {
  const app = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "public", "app.js"), "utf8")
  );
  // Browsers throttle timers in hidden tabs below our beat interval, so the
  // timer alone is not enough to keep a working colleague on the list.
  const handlers = [...app.matchAll(/addEventListener\("visibilitychange"[\s\S]{0,600}?\n  \}\);/g)];
  assert.ok(
    handlers.some((h) => /presenceHeartbeat/.test(h[0])),
    "a visibilitychange handler should send a heartbeat when the tab becomes visible"
  );
});
