// The QA manager corrected VP-QA006's renewal date on 13 Oct 2026 and again
// twice on 15 Oct. All three edits are in the audit trail. The date in Drive
// never changed.
//
// Cause: a document carried no record of when it was last changed, so the merge
// resolved metadata by argument order, and the per-document sync guessed
// freshness from the newest version-history entry. Correcting a date adds no
// history entry — that only happens if you fill in "Changes" or bump the
// version — so an edited copy and a stale one looked equally fresh, and the
// tie went to the stale copy.
//
// These tests replay that exact situation.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mergeDocument, mergeDocuments, mergeBackupPayload, touchedAt,
} from "../src/merge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");

// VP-QA006 as it really is in Drive: two history entries, both dated
// 2026-05-24, and no stamp of its own.
const HISTORY = [
  { version: "00", date: "2026-05-24", author: "Sanjiv Kumar Verma", changes: "FIRST COPY OF DOCUMENT" },
  { version: "00", date: "2026-05-24", author: "Satwinder", changes: "FIRST COPY OF DOCUMENT" },
];
const stale = () => ({
  id: "VP-QA006", title: "SITE MASTER FILE", version: "00", status: "Approved",
  effectiveDate: "2024-03-05", renewalDate: "2026-03-04", history: HISTORY,
});
/** The same document after the QA manager corrects the dates. */
const edited = (at = "2026-10-15T07:09:51.000Z") => ({
  ...stale(), effectiveDate: "2026-03-05", renewalDate: "2028-03-04", updatedAt: at,
});

// ---- the edit must survive every path that touches a document --------------

test("the 60-second background pull does not discard a fresh edit", () => {
  // Hydration passes (remote, local). Before the stamp existed, remote won on
  // every metadata field and the edit was gone within a minute of being made.
  const merged = mergeDocuments([stale()], [edited()])[0];
  assert.equal(merged.renewalDate, "2028-03-04");
  assert.equal(merged.effectiveDate, "2026-03-05");
});

test("a browser holding an old copy cannot overwrite the edit on Drive", () => {
  // You do not have to edit anything to trigger this: signing in writes an
  // audit entry, which arms the auto-sync and pushes that browser's whole
  // document list.
  const pushed = mergeBackupPayload(
    { velite_documents: JSON.stringify([stale()]) },
    { velite_documents: JSON.stringify([edited()]) }
  );
  const doc = JSON.parse(pushed.data.velite_documents)[0];
  assert.equal(doc.renewalDate, "2028-03-04", "a stale push must not roll Drive back");
});

test("the per-document metadata file cannot override a fresh edit", () => {
  // VP-QA006 has four doc-VP-QA006.json files in Drive. The stale ones must not
  // win. Here the local copy is the incoming/authoritative side.
  const merged = mergeDocument(edited(), stale());
  assert.equal(merged.renewalDate, "2028-03-04");
});

test("the newer of two edits wins, whichever side it arrives on", () => {
  const older = edited("2026-10-13T07:38:06.000Z");   // 13 Oct, 1:08 PM IST
  const newer = { ...edited("2026-10-15T07:10:43.000Z"), renewalDate: "2029-01-01" };
  assert.equal(mergeDocument(older, newer).renewalDate, "2029-01-01", "existing is newer");
  assert.equal(mergeDocument(newer, older).renewalDate, "2029-01-01", "incoming is newer");
});

test("an edit survives being pulled, pushed and pulled again", () => {
  // The full round trip. The edit used to be lost at the first step and then
  // written back over itself at the second.
  let local = edited();
  local = mergeDocuments([stale()], [local])[0];                       // pull
  const drive = JSON.parse(mergeBackupPayload(
    { velite_documents: JSON.stringify([local]) },
    { velite_documents: JSON.stringify([stale()]) }
  ).data.velite_documents)[0];                                         // push
  const after = mergeDocuments([drive], [local])[0];                   // pull again
  assert.equal(after.renewalDate, "2028-03-04");
  assert.equal(drive.renewalDate, "2028-03-04");
});

// ---- the stamp itself ------------------------------------------------------

test("a document with no stamp behaves exactly as it did before", () => {
  // ~930 live documents carry no stamp. Until they are next edited the rule
  // must not change, or this fix would itself start moving data around.
  const a = { id: "X", renewalDate: "A" }, b = { id: "X", renewalDate: "B" };
  assert.equal(mergeDocument(a, b).renewalDate, "A", "incoming still wins when neither is stamped");
});

test("a stamped edit outranks an unstamped copy in both directions", () => {
  assert.equal(touchedAt(stale()), "");
  assert.ok(touchedAt(edited()));
  assert.equal(mergeDocument(edited(), stale()).renewalDate, "2028-03-04");
  assert.equal(mergeDocument(stale(), edited()).renewalDate, "2028-03-04");
});

test("equal stamps are not treated as a conflict", () => {
  const at = "2026-10-15T07:09:51.000Z";
  const a = { ...edited(at), title: "A" }, b = { ...edited(at), title: "B" };
  assert.equal(mergeDocument(a, b).title, "A", "same save; incoming is fine");
});

test("a malformed stamp is ignored rather than trusted", () => {
  const bogus = { ...stale(), updatedAt: 12345 };
  assert.equal(touchedAt(bogus), "", "only a string counts as a stamp");
  assert.equal(mergeDocument(edited(), bogus).renewalDate, "2028-03-04");
});

test("attachments and history are still protected, whichever side wins metadata", () => {
  // The stamp decides metadata only. A stale copy that wins nothing must still
  // not drop an attachment, and no history entry may be lost.
  const withFile = {
    ...stale(),
    wordFile: { name: "smf.doc", driveFileId: "abc", uploadedAt: "2026-10-11T10:46:12.156Z" },
    history: [...HISTORY, { version: "00", date: "2026-04-01", author: "Ramna", changes: "earlier" }],
  };
  const merged = mergeDocument(edited(), withFile);
  assert.equal(merged.renewalDate, "2028-03-04", "the edit wins metadata");
  assert.equal(merged.wordFile.driveFileId, "abc", "the attachment it never heard about survives");
  assert.equal(merged.history.length, 3, "no history entry is lost");
});

// ---- the stamp has to be set where a person edits, and nowhere else --------

test("every deliberate edit path stamps the document", () => {
  for (const [fn, pattern] of [
    ["saveDocument (edit)", /window\.saveDocument[\s\S]*?touchDoc\(docs\[idx\]\)/],
    ["saveDocument (create)", /touchDoc\(newDoc\);[\s\S]{0,80}docs\.push\(newDoc\)/],
    ["executeDocumentRenewal", /window\.executeDocumentRenewal[\s\S]*?touchDoc\(docs\[idx\]\)/],
  ]) {
    assert.match(appJs, pattern, `${fn} should stamp the document it changes`);
  }
});

test("sync code never stamps, or a stale browser would win forever", () => {
  // A browser that restamped on every pull would make its old copy look like
  // the freshest edit in the system.
  for (const name of ["pullDocsFromDriveMeta", "mergeRemoteData"]) {
    const body = appJs.match(new RegExp(`(?:window\\.)?${name} = (?:async )?function[\\s\\S]*?\\n  \\};`))
              || appJs.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n  \\}\\n`));
    assert.ok(body, `${name} should exist`);
    assert.ok(!/touchDoc\(/.test(body[0]), `${name} must not stamp documents`);
  }
});

test("there is one document merge rule, not three", () => {
  // Two hand-rolled copies judged freshness by history[0].date. Both are gone;
  // documents go through the shared rule in /merge.js.
  const meta = appJs.match(/window\.pullDocsFromDriveMeta = [\s\S]*?\n  \};/)[0];
  assert.match(meta, /getMergeRules/, "the per-doc sync should use the shared rule");
  assert.ok(!/history && \w+\.history\[0\]/.test(meta), "no local freshness heuristic should remain");

  assert.match(appJs, /mergeArrayById\("velite_documents", "id", docTs, "documents", sharedMerge/,
    "the backup pull should hand documents to the shared rule");
});
