import test from "node:test";
import assert from "node:assert/strict";
import {
  pickAttachment,
  mergeHistory,
  mergeDocuments,
  mergeTombstones,
  mergeAuditLogs,
  mergeBackupPayload,
} from "../src/merge.js";

const pdf = (id, uploadedAt) => ({
  name: "SOP.pdf",
  type: "application/pdf",
  size: 1234,
  idbKey: null,
  driveFileId: id,
  driveName: "VP-QA059-pdf-SOP.pdf",
  byteVerified: true,
  uploadedAt,
});

const doc = (id, extra = {}) => ({
  id,
  title: `Doc ${id}`,
  version: "1.0",
  status: "Approved",
  wordFile: null,
  pdfFile: null,
  history: [{ version: "1.0", date: "2026-05-24", author: "QA", changes: "Initial." }],
  ...extra,
});

// ---- the reported bug -------------------------------------------------

test("a stale push cannot erase a PDF another device just uploaded", () => {
  // Device A uploaded a PDF for VP-QA059.
  const stored = [doc("VP-QA059", { pdfFile: pdf("drive-abc", "2026-09-17T07:33:07Z") })];
  // Device B loaded before that upload, so its copy still has pdfFile: null.
  const pushed = [doc("VP-QA059")];

  const merged = mergeDocuments(pushed, stored);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].pdfFile.driveFileId, "drive-abc", "A's PDF must survive B's stale push");
});

test("the same protection applies to Word attachments", () => {
  const stored = [doc("VP-QA001", { wordFile: pdf("word-1", "2026-09-17T07:00:00Z") })];
  const merged = mergeDocuments([doc("VP-QA001")], stored);
  assert.equal(merged[0].wordFile.driveFileId, "word-1");
});

test("a genuine replacement still wins over the older upload", () => {
  const stored = [doc("VP-QA059", { pdfFile: pdf("old", "2026-09-10T00:00:00Z") })];
  const pushed = [doc("VP-QA059", { pdfFile: pdf("new", "2026-09-17T00:00:00Z") })];
  const merged = mergeDocuments(pushed, stored);
  assert.equal(merged[0].pdfFile.driveFileId, "new");
});

test("an older upload arriving late does not clobber the newer one", () => {
  const stored = [doc("VP-QA059", { pdfFile: pdf("new", "2026-09-17T00:00:00Z") })];
  const pushed = [doc("VP-QA059", { pdfFile: pdf("old", "2026-09-10T00:00:00Z") })];
  const merged = mergeDocuments(pushed, stored);
  assert.equal(merged[0].pdfFile.driveFileId, "new");
});

// ---- documents, not just attachments ----------------------------------

test("a document missing from a stale push is not dropped", () => {
  const stored = [doc("VP-QA001"), doc("VP-QA059")];
  const merged = mergeDocuments([doc("VP-QA001")], stored);
  assert.deepEqual(merged.map((d) => d.id).sort(), ["VP-QA001", "VP-QA059"]);
});

test("metadata edits from the pushing client are applied", () => {
  const stored = [doc("VP-QA059", { title: "Old title", status: "Draft" })];
  const pushed = [doc("VP-QA059", { title: "New title", status: "Approved" })];
  const merged = mergeDocuments(pushed, stored);
  assert.equal(merged[0].title, "New title");
  assert.equal(merged[0].status, "Approved");
});

test("an explicit tombstone still deletes, and survives a stale push", () => {
  const stored = [doc("VP-QA001"), doc("VP-QA059")];
  const merged = mergeDocuments([doc("VP-QA001"), doc("VP-QA059")], stored, ["VP-QA059"]);
  assert.deepEqual(merged.map((d) => d.id), ["VP-QA001"]);
});

test("document ids are matched case-insensitively", () => {
  const stored = [doc("VP-QA059", { pdfFile: pdf("drive-abc", "2026-09-17T00:00:00Z") })];
  const merged = mergeDocuments([doc("vp-qa059")], stored);
  assert.equal(merged.length, 1, "must not create a duplicate record");
  assert.equal(merged[0].pdfFile.driveFileId, "drive-abc");
});

// ---- supporting pieces -------------------------------------------------

test("pickAttachment prefers a real Drive pointer over nothing", () => {
  const real = pdf("x", "2026-09-17T00:00:00Z");
  assert.equal(pickAttachment(null, real), real);
  assert.equal(pickAttachment(undefined, real), real);
  assert.equal(pickAttachment(real, null), real);
  assert.equal(pickAttachment(null, null), null);
});

test("pickAttachment ignores a pointer with no Drive file behind it", () => {
  const stub = { name: "local-only.pdf", driveFileId: null };
  const real = pdf("x", "2026-09-17T00:00:00Z");
  assert.equal(pickAttachment(stub, real), real);
});

test("revision history is unioned, never truncated", () => {
  const incoming = [{ version: "2.0", date: "2026-09-01", author: "A", changes: "Renewed" }];
  const existing = [{ version: "1.0", date: "2026-05-24", author: "B", changes: "Initial." }];
  assert.equal(mergeHistory(incoming, existing).length, 2);
  assert.equal(mergeHistory(incoming, incoming).length, 1, "identical entries are not duplicated");
});

test("tombstones union and do not resurrect", () => {
  const merged = mergeTombstones([{ id: "A" }], [{ id: "B" }]);
  assert.deepEqual(merged.map((t) => t.id).sort(), ["A", "B"]);
});

test("audit log entries from both sides are kept", () => {
  const a = [{ timestamp: "t1", user: "u", action: "a1", division: "d" }];
  const b = [{ timestamp: "t2", user: "u", action: "a2", division: "d" }];
  assert.equal(mergeAuditLogs(a, b).length, 2);
  assert.equal(mergeAuditLogs(a, a).length, 1);
});

// ---- whole-payload behaviour ------------------------------------------

test("mergeBackupPayload protects attachments and reports what it saved", () => {
  const existing = {
    velite_documents: JSON.stringify([
      doc("VP-QA059", { pdfFile: pdf("drive-abc", "2026-09-17T07:33:07Z") }),
      doc("VP-QA060"),
    ]),
    velite_batches: '[{"batchNo":"B1"}]',
  };
  const incoming = {
    velite_documents: JSON.stringify([doc("VP-QA059")]),
    velite_batches: '[{"batchNo":"B1"},{"batchNo":"B2"}]',
  };

  const { data, stats } = mergeBackupPayload(incoming, existing);
  const docs = JSON.parse(data.velite_documents);

  assert.equal(docs.length, 2, "VP-QA060 must not vanish");
  assert.equal(docs.find((d) => d.id === "VP-QA059").pdfFile.driveFileId, "drive-abc");
  assert.equal(stats.attachmentsPreserved, 1);
  assert.equal(stats.documentsRecovered, 1);
  assert.equal(data.velite_batches, incoming.velite_batches, "other keys pass through untouched");
});

test("mergeBackupPayload keeps a key the push omits entirely", () => {
  const existing = { velite_documents: "[]", velite_stability: '[{"s":1}]' };
  const { data } = mergeBackupPayload({ velite_documents: "[]" }, existing);
  assert.equal(data.velite_stability, '[{"s":1}]');
});

test("mergeBackupPayload is a plain passthrough on first ever write", () => {
  const incoming = { velite_documents: JSON.stringify([doc("VP-QA001")]) };
  const { data } = mergeBackupPayload(incoming, null);
  assert.equal(data.velite_documents, incoming.velite_documents);
});

test("mergeBackupPayload survives corrupt stored JSON without dropping the push", () => {
  const existing = { velite_documents: "{not json" };
  const incoming = { velite_documents: JSON.stringify([doc("VP-QA001")]) };
  const { data } = mergeBackupPayload(incoming, existing);
  assert.equal(JSON.parse(data.velite_documents).length, 1);
});
