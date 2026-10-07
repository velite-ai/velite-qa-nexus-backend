// Exercises the real sign-in roster reconcile in public/data/mockData.js by
// running that file in a sandbox with a fake browser, rather than reimplementing
// its logic here. Staff changes are made by editing initialUsers and deploying,
// so this is the test that someone who left actually disappears.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "mockData.js");
const source = readFileSync(SRC, "utf8");

function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
}

/** Run mockData.js against a given starting localStorage and return the result. */
function boot(seed = {}) {
  const localStorage = makeLocalStorage(seed);
  const logs = [];
  const ctx = createContext({
    localStorage,
    window: { __VELITE_DEVICE_ID: "test-device" }, // backend-managed mode
    console: { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")) },
  });
  runInNewContext(source, ctx);
  const users = JSON.parse(localStorage.getItem("velite_users") || "[]");
  return { users, logs, localStorage, byName: new Map(users.map((u) => [u.name, u])) };
}

const names = (users) => users.map((u) => u.name).sort();

// ---- the roster as deployed ------------------------------------------------

test("a fresh browser seeds exactly the seven people on the roster", () => {
  const { users } = boot();
  assert.deepEqual(names(users), [
    "Pawan", "Rajeev", "Ritika", "Sachin", "Sanjiv Kumar Verma", "Satwinder", "Surbhi",
  ]);
});

test("departments and access tiers are as intended", () => {
  const { byName } = boot();
  assert.equal(byName.get("Sanjiv Kumar Verma").department, "Executive");
  assert.equal(byName.get("Satwinder").department, "Executive");
  assert.equal(byName.get("Ritika").department, "Executive", "QA Head keeps Executive-tier rights");
  assert.equal(byName.get("Sachin").department, "Quality Control");
  assert.equal(byName.get("Rajeev").department, "Quality Control");
  assert.equal(byName.get("Rajeev").role, "Microbiologist");
  assert.equal(byName.get("Surbhi").department, "Production");
  assert.equal(byName.get("Pawan").department, "HR");
  assert.equal(byName.get("Pawan").role, "HR Officer");
  assert.equal(byName.get("Ritika").role, "QA Officer");
  assert.equal(byName.get("Ritika").email, "qualityassurance1.velite@gmail.com");
});

test("every new joiner is global, so they see both divisions", () => {
  const { byName } = boot();
  for (const n of ["Ritika", "Sachin", "Rajeev", "Surbhi", "Pawan"]) {
    assert.equal(byName.get(n).division, "global", `${n} should be global`);
  }
});

test("every roster entry has the fields the sign-in screen renders", () => {
  const { users } = boot();
  for (const u of users) {
    for (const field of ["email", "name", "role", "department", "avatar", "division"]) {
      assert.ok(u[field], `${u.name || u.email} is missing ${field}`);
    }
    assert.match(u.email, /^[^@\s]+@[^@\s]+$/, `${u.name} has a malformed email`);
  }
  const emails = users.map((u) => u.email.toLowerCase());
  assert.equal(new Set(emails).size, emails.length, "emails must be unique");
});

// ---- reconciling a browser that already had the old roster ------------------

const OLD_ROSTER = JSON.stringify([
  { email: "sanjiv.verma@velite.com", name: "Sanjiv Kumar Verma", role: "CEO", department: "Executive", avatar: "SV", division: "global" },
  { email: "vikram.sen@velite.com", name: "Vikram Sen", role: "Supervisor", department: "Production", avatar: "VS", division: "pharma" },
  { email: "ramesh.kumar@velite.com", name: "Ramesh Kumar", role: "Operator", department: "Production", avatar: "RK", division: "cosmetics" },
  { email: "nivedita.rao@velite.com", name: "Dr. Nivedita Rao", role: "Analyst", department: "Quality Control", avatar: "NR", division: "cosmetics" },
  { email: "sharma.qa@velite.com", name: "Rajesh Sharma", role: "Manager", department: "Quality Assurance", avatar: "RS", division: "pharma" },
  { email: "ramna@velite.com", name: "Ramna", role: "QA Head", department: "Executive", avatar: "RA", division: "global" },
  { email: "satwinder@velite.com", name: "Satwinder", role: "QA Head", department: "Executive", avatar: "SW", division: "global" },
]);

test("an existing browser converges on the new roster", () => {
  const { users } = boot({ velite_users: OLD_ROSTER });
  assert.deepEqual(names(users), [
    "Pawan", "Rajeev", "Ritika", "Sachin", "Sanjiv Kumar Verma", "Satwinder", "Surbhi",
  ]);
});

test("people who left are removed, not left on the sign-in screen", () => {
  const { users } = boot({ velite_users: OLD_ROSTER });
  for (const gone of ["Vikram Sen", "Ramesh Kumar", "Dr. Nivedita Rao", "Rajesh Sharma", "Ramna"]) {
    assert.ok(!users.some((u) => u.name === gone), `${gone} should no longer appear`);
  }
});

test("Ramna's seat is replaced by Ritika rather than both appearing", () => {
  const { users } = boot({ velite_users: OLD_ROSTER });
  assert.ok(!users.some((u) => u.email === "ramna@velite.com"));
  const ritika = users.find((u) => u.email === "qualityassurance1.velite@gmail.com");
  assert.ok(ritika, "Ritika must be present");
  assert.equal(ritika.role, "QA Officer");
  assert.equal(ritika.department, "Executive");
});

test("a roster change is written to the audit log", () => {
  const { localStorage } = boot({ velite_users: OLD_ROSTER });
  const logs = JSON.parse(localStorage.getItem("velite_audit_logs") || "[]");
  assert.ok(logs.length > 0, "a roster change must leave an audit entry");
  assert.match(logs[0].action, /roster reconciled/i);
  assert.match(logs[0].action, /Ritika/);
  assert.match(logs[0].action, /Ramna/);
});

test("a browser already on the new roster is left untouched and logs nothing", () => {
  const first = boot({ velite_users: OLD_ROSTER });
  const settled = first.localStorage.getItem("velite_users");
  const auditBefore = first.localStorage.getItem("velite_audit_logs");

  const second = boot({ velite_users: settled, velite_audit_logs: auditBefore });
  assert.equal(second.localStorage.getItem("velite_users"), settled, "reconcile must be idempotent");
  assert.equal(
    JSON.parse(second.localStorage.getItem("velite_audit_logs")).length,
    JSON.parse(auditBefore).length,
    "no second audit entry when nothing changed"
  );
});

test("a corrupt roster is replaced rather than crashing the app", () => {
  const { users } = boot({ velite_users: "{not json" });
  assert.equal(users.length, 7);
});

test("documents, deviations and batches are still not seeded in backend mode", () => {
  const { localStorage } = boot();
  for (const k of ["velite_documents", "velite_deviations", "velite_stability", "velite_batches"]) {
    assert.equal(localStorage.getItem(k), null, `${k} must come from Drive, not the mock seed`);
  }
});

// ---- the roster must survive the Drive pull ---------------------------------
//
// mockData.js reconciles velite_users synchronously on load; the adapter's
// hydration finishes a moment later, after its network round-trip. When that
// hydration wrote velite_users from Drive it undid the reconcile on every page
// load, so a staff change deployed and then silently reverted. These guard the
// fix structurally — the hydration loop lives in a browser IIFE with network
// calls, which is not worth standing up a fake DOM for.

import { readFileSync as _read } from "node:fs";
const adapter = _read(
  join(dirname(fileURLToPath(import.meta.url)), "..", "public", "backend-adapter.js"),
  "utf8"
);

test("hydration skips velite_users, so the deployed roster is not overwritten", () => {
  assert.match(
    adapter,
    /if \(k === "velite_users"\) continue;/,
    "the Drive pull must not write velite_users, or staff changes revert on every load"
  );
});

test("the skip sits inside the hydration key loop, not somewhere inert", () => {
  const loop = adapter.match(/for \(const \[k, v\] of Object\.entries\(dataObj\)\)[\s\S]*?\n      \}/);
  assert.ok(loop, "the hydration key loop should still exist");
  assert.ok(
    loop[0].includes('if (k === "velite_users") continue;'),
    "the velite_users skip must be inside the loop that writes keys to localStorage"
  );
});

test("the skip comes before any write, so no path can still set it", () => {
  const loop = adapter.match(/for \(const \[k, v\] of Object\.entries\(dataObj\)\)[\s\S]*?\n      \}/)[0];
  const skipAt = loop.indexOf('if (k === "velite_users") continue;');
  const firstWriteAt = loop.indexOf("localStorage.setItem");
  assert.ok(skipAt !== -1 && firstWriteAt !== -1);
  assert.ok(skipAt < firstWriteAt, "the skip must precede every localStorage write in the loop");
});
