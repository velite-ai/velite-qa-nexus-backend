// A browser keeps the chosen file in an <input type="file"> until something
// clears it. openDocumentModal reset every text field but not those two inputs,
// so creating a document straight after uploading to another one re-uploaded the
// previous file: the form still held it, and saveDocument reads
// wordInput.files[0] without asking whether the user picked it this time.
//
// Whole runs of documents ended up carrying one unrelated file. On 15 Oct 2026
// VP-WH010's Word and PDF were attached to the sixteen QC test procedures
// created after it, over the following half hour. Across the vault this reached
// 173 files shared over 515 attachment slots.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appJs = readFileSync(join(ROOT, "app.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");

const FILE_INPUTS = ["modal-doc-word", "modal-doc-pdf"];

test("the upload fields exist and are real file inputs", () => {
  for (const id of FILE_INPUTS) {
    const el = indexHtml.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(el, `${id} should exist`);
    assert.match(el[0], /type="file"/);
  }
});

test("opening the document form empties both upload fields", () => {
  const opener = appJs.match(/window\.openDocumentModal = function[\s\S]*?\n  \};/);
  assert.ok(opener, "openDocumentModal should exist");
  assert.match(opener[0], /clearDocFileInputs\(\)/, "the form must not open holding a previous file");

  // It has to happen before the edit branch fills the form in, so editing an
  // existing document never inherits a file chosen for a different one.
  const clearAt = opener[0].indexOf("clearDocFileInputs()");
  const editAt = opener[0].indexOf("if (docId)");
  assert.ok(clearAt !== -1 && clearAt < editAt, "clear before populating for an edit");
});

test("closing the form empties them too", () => {
  const closer = appJs.match(/window\.closeDocumentModal = [\s\S]*?\n  \};/);
  assert.ok(closer, "closeDocumentModal should exist");
  assert.match(closer[0], /clearDocFileInputs\(\)/,
    "a file must not outlive the form it was chosen in, however the modal is reopened next");
});

test("clearing actually empties both inputs", () => {
  // Run the real function against stand-in elements.
  const body = appJs.match(/function clearDocFileInputs\(\) \{[\s\S]*?\n  \}/);
  assert.ok(body, "clearDocFileInputs should exist");
  const els = Object.fromEntries(FILE_INPUTS.map((id) => [id, { value: "C:/fakepath/VP-WH010.doc" }]));
  const ctx = { document: { getElementById: (id) => els[id] || null } };
  runInNewContext(`${body[0]}; clearDocFileInputs();`, ctx);
  for (const id of FILE_INPUTS) assert.equal(els[id].value, "", `${id} should be empty`);
});

test("clearing copes with a missing element rather than throwing", () => {
  const body = appJs.match(/function clearDocFileInputs\(\) \{[\s\S]*?\n  \}/)[0];
  const ctx = { document: { getElementById: () => null } };
  assert.doesNotThrow(() => runInNewContext(`${body}; clearDocFileInputs();`, ctx));
});

test("an empty upload field never wipes an attachment that is already there", () => {
  // The fix means most saves now arrive with no file chosen. That must read as
  // "no new upload", not as "remove the attachment".
  const store = appJs.match(/async function storeUploadedFile\(file, kind\) \{[\s\S]*?\n    \}/);
  assert.ok(store, "storeUploadedFile should exist");
  assert.match(store[0], /if \(!file\) return undefined;/, "no file means no upload object");

  const save = appJs.match(/window\.saveDocument = async function[\s\S]*?\n  \};/)[0];
  assert.match(save, /if \(wordFileObj\) docs\[idx\]\.wordFile = wordFileObj;/,
    "an existing Word attachment is only replaced when a new one was chosen");
  assert.match(save, /if \(pdfFileObj\) docs\[idx\]\.pdfFile = pdfFileObj;/,
    "an existing PDF attachment is only replaced when a new one was chosen");
});

test("no other form in the app carries the same trap", () => {
  const all = [...indexHtml.matchAll(/<input[^>]*type="file"[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(all.sort(), [...FILE_INPUTS].sort(),
    "a new file input needs the same clearing, or it will repeat this bug");
});
