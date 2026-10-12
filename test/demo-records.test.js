// Two deviations and two batches from the May 2026 prototype were still in the
// live data, so the Pharmaceuticals dashboard reported one Open Deviation and
// one BMR Quarantine that did not exist on the shop floor.
//
// Removing them locally is not enough: they live in Drive's backup.json, and
// the shim hydrates from Drive after mockData.js has already run, then again
// every 60 seconds. Whatever strips them has to sit in the hydration path. That
// is the same race that used to revert the sign-in roster, so it is pinned here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const adapterJs = readFileSync(join(ROOT, "backend-adapter.js"), "utf8");
const mockDataJs = readFileSync(join(ROOT, "data", "mockData.js"), "utf8");

/** The real DEMO_SEED_RECORDS table and stripper, lifted out of the shim. */
function loadStripper() {
  const table = adapterJs.match(/const DEMO_SEED_RECORDS = \{[\s\S]*?\n  \};/);
  assert.ok(table, "DEMO_SEED_RECORDS should be a single object literal in backend-adapter.js");
  const fn = adapterJs.match(/\n  function stripDemoRecords\(storeKey, rawJson\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "stripDemoRecords() should be a plain function declaration");
  const ctx = { window: {}, console };
  runInNewContext(`${table[0]}\n${fn[0]}\nwindow.strip = stripDemoRecords; window.table = DEMO_SEED_RECORDS;`, ctx);
  // Values built inside the sandbox carry that realm's prototypes, which strict
  // deep-equality rejects. Copy them back into this realm so the assertions
  // compare contents rather than realms.
  const sandboxed = ctx.window.strip;
  return {
    table: JSON.parse(JSON.stringify(ctx.window.table)),
    strip: (storeKey, raw) => {
      const r = sandboxed(storeKey, raw);
      return { json: r.json, removed: [...r.removed] };
    },
  };
}

const { strip, table } = loadStripper();

const DEMO_DEV = {
  id: "DEV-2026-004",
  title: "Temperature excursion in Incubator QC-INC-03 during stability study",
  status: "CAPA Assigned",
};
const DEMO_BATCH = {
  batchNo: "VP-BT-409",
  productName: "Betamethasone Dipropionate Ointment (Drugs)",
  division: "Pharmaceuticals",
  status: "Quarantined",
};

// ---- what gets removed -----------------------------------------------------

test("the two prototype deviations are removed", () => {
  const r = strip("velite_deviations", JSON.stringify([
    DEMO_DEV,
    { id: "DEV-2026-005", title: "Bulk mixing speed deviation during ointment batch manufacture", status: "Closed" },
  ]));
  assert.deepEqual(JSON.parse(r.json), []);
  assert.equal(r.removed.length, 2);
});

test("the two prototype batches are removed", () => {
  const r = strip("velite_batches", JSON.stringify([
    DEMO_BATCH,
    { batchNo: "VH-SHC-602", productName: "Ultra-Hydrating Cocoa Butter Cream (Cosmetics)", status: "Ready for Sensory QC" },
  ]));
  assert.deepEqual(JSON.parse(r.json), []);
  assert.equal(r.removed.length, 2);
});

test("the removal is reported in terms a person can check against the dashboard", () => {
  const r = strip("velite_deviations", JSON.stringify([DEMO_DEV]));
  assert.deepEqual(r.removed, [
    "DEV-2026-004 (Temperature excursion in Incubator QC-INC-03 during stability study)",
  ]);
});

// ---- what must survive -----------------------------------------------------

test("real records alongside the demo ones are untouched", () => {
  const real = { id: "DEV-2026-006", title: "Fill weight variation on line 2", status: "Open" };
  const r = strip("velite_deviations", JSON.stringify([DEMO_DEV, real]));
  assert.deepEqual(JSON.parse(r.json), [real]);
});

test("a genuine record that reuses a demo identifier is kept", () => {
  // The whole point of matching on the title as well. If QA ever logs a real
  // DEV-2026-004 this must not delete it from under them.
  const real = { id: "DEV-2026-004", title: "Fill weight variation on line 2", status: "Open" };
  const r = strip("velite_deviations", JSON.stringify([real]));
  assert.deepEqual(JSON.parse(r.json), [real]);
  assert.deepEqual(r.removed, []);
});

test("a record carrying a demo title under a real identifier is kept", () => {
  const real = { ...DEMO_DEV, id: "DEV-2027-011" };
  const r = strip("velite_deviations", JSON.stringify([real]));
  assert.deepEqual(JSON.parse(r.json), [real]);
});

test("a quarantined batch that is not the prototype one still counts", () => {
  const real = { batchNo: "VP-BT-900", productName: "Clobetasol Cream", division: "Pharmaceuticals", status: "Quarantined" };
  const r = strip("velite_batches", JSON.stringify([DEMO_BATCH, real]));
  assert.deepEqual(JSON.parse(r.json), [real]);
});

// ---- safety ----------------------------------------------------------------

test("stripping twice changes nothing the second time", () => {
  const once = strip("velite_deviations", JSON.stringify([DEMO_DEV]));
  const twice = strip("velite_deviations", once.json);
  assert.equal(twice.json, once.json);
  assert.deepEqual(twice.removed, [], "an idempotent purge must not log a removal every page load");
});

test("stores it does not know about are passed through untouched", () => {
  const raw = JSON.stringify([{ id: "VP-QA006" }]);
  const r = strip("velite_documents", raw);
  assert.equal(r.json, raw, "the document vault must never be filtered by this");
  assert.deepEqual(r.removed, []);
});

test("unreadable or unexpected data is left exactly as found", () => {
  for (const raw of ["{not json", JSON.stringify({ not: "an array" }), "null", null, undefined]) {
    const r = strip("velite_deviations", raw);
    assert.equal(r.json, raw, `${String(raw)} should be returned unchanged`);
    assert.deepEqual(r.removed, []);
  }
});

test("only deviations and batches are in scope", () => {
  assert.deepEqual(Object.keys(table).sort(), ["velite_batches", "velite_deviations"]);
});

// ---- the race that makes or breaks this -----------------------------------

test("Drive's copy is stripped as it arrives, before it reaches localStorage", () => {
  const loop = adapterJs.match(/for \(const \[k, rawValue\] of Object\.entries\(dataObj\)\) \{[\s\S]*?\n      \}/);
  assert.ok(loop, "the hydration loop should iterate the raw values from Drive");
  const stripAt = loop[0].indexOf("stripDemoRecords");
  const storeAt = loop[0].indexOf("localStorage.setItem");
  assert.ok(stripAt !== -1, "hydration must strip demo records on the way in");
  assert.ok(stripAt < storeAt, "stripping has to happen before the value is written");
});

test("the background pull goes through the same hydration path", () => {
  // Stripping only on first boot would let the 60-second pull put them back.
  const bg = adapterJs.match(/function startBackgroundPull\(\)[\s\S]*?\n  \}/);
  assert.ok(bg, "startBackgroundPull should exist");
  assert.match(bg[0], /pullAndHydrateFromDrive/, "the periodic pull must reuse the hydrate that strips");
});

test("mockData.js reuses the shim's table rather than keeping its own copy", () => {
  // Two lists would drift, and the one in mockData.js is the one that cannot
  // win the race on its own. (The legacy initialDeviations / initialBatches
  // seeds still mention these ids; they are only written in standalone mode,
  // where the purge below strips them straight back out.)
  assert.ok(!/const DEMO_SEED_RECORDS\s*=/.test(mockDataJs),
    "mockData.js should not define a second copy of the demo record table");
  assert.ok(!/"DEV-2026-004"\s*,\s*title:/.test(mockDataJs.slice(mockDataJs.indexOf("DEMO-RECORD PURGE"))),
    "the purge block should not restate the records it removes");
  assert.match(mockDataJs, /window\.veliteStripDemoRecords/, "it should call the shared stripper");
});

test("the legacy standalone seeds are stripped again after they are written", () => {
  // Standalone mode still seeds the prototype records. The purge has to run
  // after that seeding or it would hand them straight back.
  const seedAt = mockDataJs.indexOf('localStorage.setItem("velite_deviations", JSON.stringify(initialDeviations))');
  const purgeAt = mockDataJs.indexOf("DEMO-RECORD PURGE");
  assert.ok(seedAt !== -1 && purgeAt !== -1);
  assert.ok(purgeAt > seedAt, "the purge must come after the legacy seeding block");
});

test("the shim exposes the stripper before mockData.js runs", () => {
  const exposeAt = adapterJs.indexOf("window.veliteStripDemoRecords");
  const initAt = adapterJs.indexOf("window.__VELITE_READY");
  assert.ok(exposeAt !== -1, "the stripper must be published on window");
  assert.ok(exposeAt < initAt, "it has to be published synchronously, not after device approval");
});

test("a removal is written to the audit log", () => {
  // A record leaving a GMP system is a controlled change.
  assert.match(adapterJs, /function logDemoPurge\(/);
  assert.match(adapterJs, /velite_audit_logs/);
});

test("the audit entry is written once per session, not once per pull", () => {
  // Drive keeps handing the demo records back until some browser pushes its
  // stripped copy up, and the background pull runs every 60 seconds. Logging on
  // each pull would bury the audit trail under the same entry all day.
  const fn = adapterJs.match(/\n  function logDemoPurge\(removed, where\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "logDemoPurge should exist");
  assert.match(adapterJs, /let demoPurgeLogged = false;/, "there should be a once-per-session guard");
  const guardAt = fn[0].indexOf("if (demoPurgeLogged) return;");
  const writeAt = fn[0].indexOf("velite_audit_logs");
  assert.ok(guardAt !== -1, "the guard must be inside logDemoPurge");
  assert.ok(guardAt < writeAt, "the guard has to come before the audit write");
});
