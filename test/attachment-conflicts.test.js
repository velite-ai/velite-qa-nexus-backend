// Until 15 Oct 2026 the upload form kept the file chosen for the previous
// document, so a run created in one sitting all carried the first one's file.
// The form is fixed, but 464 of 939 live documents still hold a file belonging
// to another — and nothing in the app said so, which is why it ran unnoticed
// from July to October.
//
// Two things close that gap: the vault flags a document whose attachment looks
// wrong, and saving asks before attaching a file that is already on another
// document. These tests run the real detector out of public/app.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appJs = readFileSync(join(ROOT, "app.js"), "utf8");
const styleCss = readFileSync(join(ROOT, "style.css"), "utf8");

/** The real attachmentConflicts(), lifted out with the helpers it needs. */
function loadDetector() {
  const parts = [
    /const _attCanon = [^\n]+/, /const _attFold = [^\n]+/, /const _attStripExt = [^\n]+/,
    /const _realFile = [^\n]+/, /const _fileKey = [^\n]+/,
    /\n  function attachmentConflicts\(docs\) \{[\s\S]*?\n  \}/,
  ].map((re) => {
    const m = appJs.match(re);
    assert.ok(m, `missing source for ${re}`);
    return m[0];
  });
  const ctx = { window: {}, out: null };
  runInNewContext(`${parts.join("\n")}\n out = attachmentConflicts;`, ctx);
  // Results are built in the sandbox; copy notes back into this realm.
  return (docs) => {
    const m = ctx.out(docs);
    return new Map([...m.entries()].map(([k, v]) => [k, [...v]]));
  };
}
const conflicts = loadDetector();

const doc = (id, over = {}) => ({ id, title: id, ...over });
const file = (name, size = 1000) => ({ name, size, driveFileId: "x" + name });

// ---- the signal that caught this in the first place ------------------------

test("one file on two documents flags both", () => {
  const f = file("VP-WH010 OPENING AND CLOSING OF STORE.doc", 123392);
  const c = conflicts([
    doc("VP-WH010", { wordFile: f }),
    doc("VP-QC-STP-BK-001-00", { wordFile: { ...f } }),
  ]);
  assert.equal(c.size, 2, "at most one of them can be right, so both need looking at");
  assert.match(c.get("VP-QC-STP-BK-001-00")[0], /also attached to 1 other document/);
});

test("the note names the other documents, so it can be acted on", () => {
  const f = file("MASTER SOP INDEX.docx", 35103);
  const docs = ["BMR-EXT-IH-003-00", "BPR-EXT-IP-001-00", "BMR-EXT-IH-011-00"]
    .map((id) => doc(id, { wordFile: { ...f } }));
  const note = conflicts(docs).get("BMR-EXT-IH-003-00")[0];
  assert.match(note, /BPR-EXT-IP-001-00/);
  assert.match(note, /BMR-EXT-IH-011-00/);
});

test("a long list is truncated rather than unreadable", () => {
  const f = file("MASTER SOP INDEX.docx", 35103);
  const docs = Array.from({ length: 43 }, (_, i) => doc(`BMR-${String(i).padStart(3, "0")}`, { wordFile: { ...f } }));
  const note = conflicts(docs).get("BMR-000")[0];
  assert.match(note, /also attached to 42 other document/);
  assert.match(note, /\+37 more/);
});

test("a file named after a different document is flagged on its own", () => {
  const c = conflicts([
    doc("VP-QA006", { title: "SITE MASTER FILE", pdfFile: file("VP-MB021.pdf", 2207141) }),
    doc("VP-MB021", { title: "MICROBIOLOGY SOP" }),
  ]);
  assert.match(c.get("VP-QA006")[0], /named after VP-MB021, not this document/);
});

test("a unique, correctly named attachment is not flagged", () => {
  const c = conflicts([
    doc("VP-MB021", { pdfFile: file("VP-MB021.pdf", 2207141) }),
    doc("VP-MB022", { pdfFile: file("VP-MB022.pdf", 999) }),
  ]);
  assert.equal(c.size, 0);
});

// ---- things that must NOT be flagged ---------------------------------------

test("a form's file named after its parent SOP is normal", () => {
  const c = conflicts([
    doc("VP-HR001", {}),
    doc("VP-HR001-F01-00", { pdfFile: file("VP-HR001-F01-00.pdf") }),
  ]);
  assert.equal(c.size, 0, "a form named after its own id is correct");
});

test("a letter O typed for a zero is not treated as the wrong document", () => {
  // "VP-HR001-FO1-00.pdf" — letter O, not zero. A typo in the name, not a
  // wrong file, and flagging it would bury the real findings in noise.
  const c = conflicts([
    doc("VP-HR001", {}),
    doc("VP-HR001-F01-00", { pdfFile: file("VP-HR001-FO1-00.pdf") }),
  ]);
  assert.equal(c.size, 0);
});

test("a descriptive filename with no document id is left alone", () => {
  const c = conflicts([doc("VP-QA012", { pdfFile: file("EXECUTIVE SUMMARY OF STABILITY STUDY.pdf") })]);
  assert.equal(c.size, 0, "most filenames are descriptive; they cannot be judged this way");
});

test("documents with no attachments, and malformed records, are safe", () => {
  assert.equal(conflicts([doc("A"), doc("B")]).size, 0);
  assert.equal(conflicts([]).size, 0);
  assert.equal(conflicts(null).size, 0);
  assert.equal(conflicts([null, { id: null }, doc("C", { wordFile: "legacy string" })]).size, 0);
});

test("the same file in both slots of one document is not a conflict with itself", () => {
  const f = file("VP-QA006.pdf");
  const c = conflicts([doc("VP-QA006", { wordFile: { ...f }, pdfFile: { ...f } })]);
  assert.equal(c.size, 0, "one document cannot clash with itself");
});

// ---- wiring ----------------------------------------------------------------

test("the vault indexes conflicts once per render, not once per row", () => {
  const render = appJs.match(/window\.renderDocumentVault = function[\s\S]*?\n  \};/)[0];
  assert.match(render, /const conflicts = attachmentConflicts\(docs\)/);
  assert.equal((render.match(/attachmentConflicts\(/g) || []).length, 1,
    "calling it per row would rebuild the index for every document");
  assert.match(render, /badge-attach-warn/, "a flagged document should carry a visible badge");
  assert.match(render, /showAttachmentConflict\('\$\{jsAttr\(d\.id\)\}'\)/,
    "the id must be escaped — vault ids contain slashes");
});

test("the badge explains itself on hover and on click", () => {
  const render = appJs.match(/window\.renderDocumentVault = function[\s\S]*?\n  \};/)[0];
  assert.match(render, /title="\$\{escapeHtml\(conflictNotes\.join/, "hover shows the detail, escaped");
  assert.match(styleCss, /\.badge-attach-warn \{[\s\S]*?cursor: pointer/, "it should look clickable");
  const dialog = appJs.match(/window\.showAttachmentConflict = function[\s\S]*?\n  \};/);
  assert.ok(dialog, "clicking should open a readable explanation");
  assert.match(dialog[0], /Edit SOP/, "it should say how to fix it");
});

// ---- the save-time guard ---------------------------------------------------

test("saving asks before attaching a file that is already on another document", () => {
  const save = appJs.match(/window\.saveDocument = async function[\s\S]*?\n  \};/)[0];
  const guard = save.match(/const existing = db\.getDocuments\(\)[\s\S]*?\n    \}/);
  assert.ok(guard, "there should be a duplicate-file check before the upload");
  assert.match(guard[0], /a\.name === file\.name && a\.size === file\.size/,
    "match on original name and byte size — all that is knowable before uploading");
  assert.match(guard[0], /window\.confirm/, "warn, do not silently block");
  assert.match(guard[0], /String\(d\.id\)\.toUpperCase\(\) === id/,
    "re-uploading the same file to the SAME document is not a clash");
});

test("the guard runs before anything is uploaded or saved", () => {
  const save = appJs.match(/window\.saveDocument = async function[\s\S]*?\n  \};/)[0];
  const guardAt = save.indexOf("is already attached to");
  const storeAt = save.indexOf("storeUploadedFile(wf");
  assert.ok(guardAt !== -1 && storeAt !== -1);
  assert.ok(guardAt < storeAt, "asking after the upload would defeat the point");
});

test("declining leaves the document untouched", () => {
  const save = appJs.match(/window\.saveDocument = async function[\s\S]*?\n  \};/)[0];
  const guard = save.match(/if \(!window\.confirm\([\s\S]*?\n        \}/)[0];
  assert.match(guard, /return;/, "cancelling must abort the save, not fall through");
  assert.match(guard, /showNotification/, "and say why nothing was saved");
});
