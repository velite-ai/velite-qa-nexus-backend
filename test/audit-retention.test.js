// The audit trail used to end its merge with `.slice(0, 5000)`.
//
// On 30 Oct 2026 the live log held 4,820 entries and was growing by about 64 a
// day — roughly three working days from silently discarding its own oldest
// history, with nothing written down to say it had happened. An audit trail that
// quietly loses entries is a data-integrity finding in its own right: Revised
// Schedule M requires records to be complete and attributable, and ALCOA+ reads
// "Complete" as nothing removed without a trace.
//
// Nothing is dropped now, at any size. Size is reported instead.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mergeAuditLogs, mergeBackupPayload, AUDIT_SOFT_LIMIT } from "../src/merge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** n distinct entries, newest first, shaped like the real ones. */
const entries = (n, tag = "a") =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: `10/30/2026, ${String(i % 12 + 1).padStart(2, "0")}:00:00 PM`,
    user: "Satwinder",
    action: `${tag}-${i}`,
    division: "pharma",
  }));

// ---- nothing is discarded, ever --------------------------------------------

test("the log is not truncated at the old 5000 limit", () => {
  const merged = mergeAuditLogs(entries(6000, "x"), entries(6000, "y"));
  assert.equal(merged.length, 12000, "every entry from both sides must survive");
});

test("a log far past the old limit keeps every entry", () => {
  // Five years of history at the observed rate.
  assert.equal(mergeAuditLogs(entries(83000), []).length, 83000);
});

test("the live size on 30 Oct 2026 passes through whole", () => {
  assert.equal(mergeAuditLogs(entries(4820), []).length, 4820);
});

test("growing past the old limit loses nothing and keeps the oldest entry", () => {
  // The old slice kept the newest 5000 and dropped the tail, so the oldest
  // history went first — exactly the records an inspector asks to see.
  const log = entries(7000);
  const oldest = log[log.length - 1];
  const merged = mergeAuditLogs(log, []);
  assert.deepEqual(merged[merged.length - 1], oldest, "the oldest entry must still be there");
});

test("de-duplication still works, so a re-push does not double the log", () => {
  const log = entries(500);
  assert.equal(mergeAuditLogs(log, log).length, 500);
});

test("entries only one side knows about are kept", () => {
  const mine = entries(10, "mine");
  const theirs = entries(10, "theirs");
  const merged = mergeAuditLogs(mine, theirs);
  assert.equal(merged.length, 20);
  for (const e of [...mine, ...theirs]) {
    assert.ok(merged.some((m) => m.action === e.action), `${e.action} must survive`);
  }
});

// ---- size is reported, not acted on ----------------------------------------

test("passing the soft limit reports but does not cut", () => {
  let told = null;
  const merged = mergeAuditLogs(entries(AUDIT_SOFT_LIMIT + 1000), [], {
    onLarge: (n, limit) => { told = { n, limit }; },
  });
  assert.equal(merged.length, AUDIT_SOFT_LIMIT + 1000, "reporting must not shorten the log");
  assert.deepEqual(told, { n: AUDIT_SOFT_LIMIT + 1000, limit: AUDIT_SOFT_LIMIT });
});

test("a log under the soft limit says nothing", () => {
  let told = false;
  mergeAuditLogs(entries(100), [], { onLarge: () => { told = true; } });
  assert.equal(told, false);
});

test("the soft limit sits well above today's log, so it is not noise", () => {
  assert.ok(AUDIT_SOFT_LIMIT > 4820 * 2, "4,820 entries today must not trip it immediately");
});

test("a thrown reporter cannot break the merge", () => {
  const merged = mergeAuditLogs(entries(AUDIT_SOFT_LIMIT + 10), [], {
    onLarge: () => { throw new Error("logging blew up"); },
  });
  assert.equal(merged.length, AUDIT_SOFT_LIMIT + 10, "the audit data matters more than the warning");
});

// ---- the whole payload path ------------------------------------------------

test("a backup push keeps every audit entry and reports the count", () => {
  const { data, stats } = mergeBackupPayload(
    { velite_documents: "[]", velite_audit_logs: JSON.stringify(entries(4000, "in")) },
    { velite_documents: "[]", velite_audit_logs: JSON.stringify(entries(4000, "ex")) }
  );
  assert.equal(JSON.parse(data.velite_audit_logs).length, 8000, "8000 entries, none dropped");
  assert.equal(stats.auditEntries, 8000, "the count has to reach the server log");
  assert.equal(stats.auditWantsArchiving, false);
});

test("a very large log is flagged for archiving, still without loss", () => {
  const { data, stats } = mergeBackupPayload(
    { velite_documents: "[]", velite_audit_logs: JSON.stringify(entries(AUDIT_SOFT_LIMIT + 500)) },
    { velite_documents: "[]", velite_audit_logs: "[]" }
  );
  assert.equal(JSON.parse(data.velite_audit_logs).length, AUDIT_SOFT_LIMIT + 500);
  assert.equal(stats.auditWantsArchiving, true, "someone must be told it wants archiving");
});

// ---- the regression guard --------------------------------------------------

test("no silent truncation is reintroduced", () => {
  const src = readFileSync(join(ROOT, "src", "merge.js"), "utf8");
  const fn = src.match(/export function mergeAuditLogs[\s\S]*?\n\}/);
  assert.ok(fn, "mergeAuditLogs should exist");
  assert.ok(!/\.slice\(/.test(fn[0]),
    "slicing the audit log discards history without recording that it happened");
  assert.ok(!/cap\s*=\s*\d/.test(fn[0]), "no numeric cap should gate the audit log");
});

test("the server says the size out loud rather than acting on it", () => {
  const src = readFileSync(join(ROOT, "src", "server.js"), "utf8");
  assert.match(src, /auditWantsArchiving/, "the server should report a large audit log");
  assert.match(src, /NOTHING has been dropped/, "and make clear it has not truncated anything");
  assert.match(src, /auditEntries=\$\{stats\.auditEntries\}/, "every push should record the size");
});
