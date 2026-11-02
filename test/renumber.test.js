// The document ID was locked while editing, so a wrongly numbered document
// could not be corrected. That blocked the most serious finding in the vault:
// 21 documents share a number, eight of them answering to VP-EN001-F01-00 with
// only the punctuation moved.
//
// Unlocking the field is not enough on its own, and doing only that would have
// been destructive in two separate ways:
//
//   1. `isEdit` was derived from whether the ID box was disabled, so an
//      unlocked box turned every edit into a new document.
//   2. The sync merges documents by id. Renaming a record in place leaves the
//      old number alive on Drive and on every other browser, and the next merge
//      — a union by id — hands it straight back. One document becomes two.
//
// So a renumber moves the record AND tombstones the old number, which is the
// only thing the union respects.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mergeDocuments } from "../src/merge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const saveDocument = appJs.match(/window\.saveDocument = async function[\s\S]*?\n  \};/)[0];

// ---- the field is usable again ---------------------------------------------

test("the document ID can be edited", () => {
  const field = indexHtml.match(/<input[^>]*id="modal-doc-id"[^>]*>/);
  assert.ok(field, "the ID field should exist");
  assert.ok(!/\bdisabled\b/.test(field[0]), "it must not be disabled in the markup either");

  const opener = appJs.match(/window\.openDocumentModal = function[\s\S]*?\n  \};/)[0];
  assert.match(opener, /getElementById\("modal-doc-id"\)\.disabled = false;[\s\S]*?state\.editingDocId = doc\.id/,
    "editing should leave the field open and record which document is being edited");
});

test("edit mode no longer depends on the field being locked", () => {
  // This was the trap: unlocking the box would have made every edit a create.
  assert.match(saveDocument, /const isEdit = state\.editingDocId != null;/);
  assert.ok(!/isEdit = document\.getElementById\("modal-doc-id"\)\.disabled/.test(appJs),
    "deriving edit mode from the lock is what made the lock load-bearing");
});

test("opening the form to create a document clears the editing marker", () => {
  const opener = appJs.match(/window\.openDocumentModal = function[\s\S]*?\n  \};/)[0];
  const resetAt = opener.indexOf("state.editingDocId = null");
  const setAt = opener.indexOf("state.editingDocId = doc.id");
  assert.ok(resetAt !== -1 && resetAt < setAt,
    "a stale marker would make a new document overwrite the last one edited");
});

// ---- the resurrection trap -------------------------------------------------

test("renaming without a tombstone would bring the old number back", () => {
  // Demonstrates why the tombstone is required, using the real merge.
  const renamed = [{ id: "VP-EN001-F02-00", title: "Conveyor Belt PM" }];
  const whatDriveStillHas = [{ id: "VP-EN001-F01-00", title: "Conveyor Belt PM" }];
  const merged = mergeDocuments(whatDriveStillHas, renamed);
  assert.equal(merged.length, 2, "without a tombstone the union leaves two documents");
});

test("with the old number tombstoned, the merge keeps only the new one", () => {
  const renamed = [{ id: "VP-EN001-F02-00", title: "Conveyor Belt PM" }];
  const whatDriveStillHas = [{ id: "VP-EN001-F01-00", title: "Conveyor Belt PM" }];
  const merged = mergeDocuments(whatDriveStillHas, renamed, ["VP-EN001-F01-00"]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "VP-EN001-F02-00");
});

test("a renumber tombstones the old number locally and on Drive", () => {
  assert.match(saveDocument, /_addTombstone\(renumberFrom, user\)/,
    "the old number must be retired or the sync restores it");
  assert.match(saveDocument, /writeTombstoneToDriveMeta\(renumberFrom, user\)/,
    "and retired on Drive too, for every other browser");
});

// ---- what must survive the move --------------------------------------------

test("the record moves whole — the new id replaces the old on the same object", () => {
  assert.match(saveDocument, /docs\[idx\] = \{ \.\.\.docs\[idx\], id, title,/,
    "spreading the existing record keeps attachments, owner and history");
});

test("the document being edited is found by its old number", () => {
  assert.match(saveDocument, /docs\.findIndex\(d => d\.id === \(renumberFrom \|\| id\)\)/,
    "looking it up by the new number would find nothing and silently save nothing");
});

test("the renumber is written into the document's own revision history", () => {
  assert.match(saveDocument, /Document renumbered from \$\{renumberFrom\} to \$\{id\}/);
});

test("and into the audit log, saying the old number is retired", () => {
  assert.match(saveDocument, /Document renumbered: \$\{renumberFrom\} → \$\{id\}/);
  assert.match(saveDocument, /is retired and will not be reissued/);
});

test("the moved record is stamped, so a stale copy cannot undo it", () => {
  const block = saveDocument.match(/if \(renumberFrom\) \{[\s\S]*?touchDoc\(docs\[idx\]\)/);
  assert.ok(block, "touchDoc must run on the renumbered record");
});

// ---- it cannot create a new collision --------------------------------------

test("renumbering onto a number already in use is refused", () => {
  assert.match(saveDocument, /is already used by/);
  const guard = saveDocument.match(/const clash = docs\.find[\s\S]*?return;\n      \}/);
  assert.ok(guard, "the clash check should return rather than fall through");
});

test("renumbering onto a punctuation variant is refused too", () => {
  // The entire purpose is to remove numbers that differ only by punctuation,
  // so VP/EN001-F01-00 must not be accepted as different from VP-EN001-F01-00.
  assert.match(saveDocument, /replace\(\/\[\^A-Z0-9\]\/g, ""\)/,
    "the comparison has to ignore spacing and punctuation");
  assert.match(saveDocument, /same number as \$\{twin\.id\} once spacing and punctuation are ignored/);
});

test("a document is allowed to keep its own number", () => {
  // The variant check must exclude the document being renumbered, or saving an
  // edit without changing the number would refuse itself.
  assert.match(saveDocument,
    /sameBar\(d\.id\) === sameBar\(id\) && String\(d\.id\)\.toUpperCase\(\) !== String\(renumberFrom\)\.toUpperCase\(\)/);
});

test("the person is asked before the number changes", () => {
  assert.match(saveDocument, /Renumber this document\?/);
  assert.match(saveDocument, /window\.confirm/);
  const confirmAt = saveDocument.indexOf("Renumber this document?");
  const writeAt = saveDocument.indexOf("_addTombstone(renumberFrom");
  assert.ok(confirmAt < writeAt, "nothing should change before the person agrees");
});

test("an ordinary edit is not treated as a renumber", () => {
  assert.match(saveDocument,
    /const renumberFrom = isEdit && id !== String\(state\.editingDocId\)\.toUpperCase\(\)/,
    "only a changed number triggers it");
});

test("creating a document still rejects a duplicate number", () => {
  assert.match(saveDocument, /if \(docs\.some\(d => d\.id === id\)\) \{ showNotification\(`Document ID \$\{id\} already exists/);
});
