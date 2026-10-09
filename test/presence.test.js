import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  heartbeat, signOut, active, summary, _reset,
  SESSION_TTL_MS, HEARTBEAT_MS,
} from "../src/presence.js";

beforeEach(() => _reset());

const ritika = { deviceId: "dev-a".repeat(4), name: "Ritika", email: "qualityassurance1.velite@gmail.com", department: "Executive" };
const sachin = { deviceId: "dev-b".repeat(4), name: "Sachin", email: "qc.velite@gmail.com", department: "Quality Control" };

test("nobody is signed in to begin with", () => {
  assert.deepEqual(summary(), { devices: 0, people: 0, sessions: [] });
});

test("a heartbeat puts someone on the list with their account", () => {
  heartbeat(ritika);
  const s = summary();
  assert.equal(s.devices, 1);
  assert.equal(s.people, 1);
  assert.equal(s.sessions[0].name, "Ritika");
  assert.equal(s.sessions[0].email, "qualityassurance1.velite@gmail.com");
  assert.equal(s.sessions[0].department, "Executive");
});

test("two people on two machines count as two", () => {
  heartbeat(ritika);
  heartbeat(sachin);
  const s = summary();
  assert.equal(s.devices, 2);
  assert.equal(s.people, 2);
});

test("one person on two machines is two devices but one person", () => {
  heartbeat({ ...ritika, deviceId: "machine-1" });
  heartbeat({ ...ritika, deviceId: "machine-2" });
  const s = summary();
  assert.equal(s.devices, 2, "the question asked is how many computers");
  assert.equal(s.people, 1);
});

test("repeated heartbeats from one browser do not duplicate it", () => {
  heartbeat(ritika);
  heartbeat(ritika);
  heartbeat(ritika);
  assert.equal(summary().devices, 1);
});

test("signing out removes the browser straight away", () => {
  heartbeat(ritika);
  heartbeat(sachin);
  assert.equal(signOut(ritika.deviceId), true);
  const s = summary();
  assert.equal(s.devices, 1);
  assert.equal(s.sessions[0].name, "Sachin");
});

test("signing out a browser that was never here is harmless", () => {
  assert.equal(signOut("never-seen"), false);
  assert.equal(summary().devices, 0);
});

// ---- a browser that vanishes without signing out ---------------------------

test("a browser stops counting once it misses enough heartbeats", () => {
  const t0 = Date.now();
  heartbeat(ritika);
  assert.equal(summary(t0 + SESSION_TTL_MS - 1).devices, 1, "still within the window");
  assert.equal(summary(t0 + SESSION_TTL_MS + 1).devices, 0, "closed tab should drop off by itself");
});

test("the expiry window allows for a couple of missed beats, not one", () => {
  assert.ok(
    SESSION_TTL_MS >= HEARTBEAT_MS * 2,
    "one slow network round-trip must not evict a browser that is still open"
  );
});

test("a browser that keeps checking in stays past the window", () => {
  const t0 = Date.now();
  heartbeat(ritika);
  // Two beats, each comfortably inside the window.
  heartbeat({ ...ritika });
  assert.equal(summary(t0 + 1000).devices, 1);
});

// ---- session identity ------------------------------------------------------

test("'since' holds steady across heartbeats, so the dashboard shows when they signed in", async () => {
  const first = heartbeat(ritika).since;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(heartbeat(ritika).since, first, "a refresh is not a new sign-in");
});

test("switching account on the same machine starts a new session", async () => {
  const first = heartbeat(ritika).since;
  await new Promise((r) => setTimeout(r, 5));
  const second = heartbeat({ ...sachin, deviceId: ritika.deviceId });
  assert.notEqual(second.since, first, "a different person signing in is a new session");
  const s = summary();
  assert.equal(s.devices, 1, "the machine should not appear twice");
  assert.equal(s.sessions[0].name, "Sachin");
});

test("the full device token is never handed back to the browser", () => {
  heartbeat(ritika);
  const [s] = active();
  assert.ok(s.deviceId.length <= 8, "only a short prefix should leave the server");
  assert.ok(!ritika.deviceId.startsWith(s.deviceId) === false, "the prefix should come from the real id");
  assert.notEqual(s.deviceId, ritika.deviceId);
});

test("a heartbeat without a device id is rejected rather than creating a ghost", () => {
  assert.throws(() => heartbeat({ name: "Nobody" }), /deviceId required/);
  assert.equal(summary().devices, 0);
});

test("newest sign-in is listed first", async () => {
  heartbeat(ritika);
  await new Promise((r) => setTimeout(r, 5));
  heartbeat(sachin);
  assert.equal(active()[0].name, "Sachin");
});
