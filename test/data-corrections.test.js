// Two corrections agreed with the CEO on 30 Oct 2026:
//
//   - Ramna has left; ownership of her 58 documents passes to Ritika
//   - 9 documents were filed under the department "QA", which is a hat name and
//     not a department, so no hat matched them and they appeared only under the
//     CEO hat. Among them was VP-QA021, the out-of-specification procedure —
//     a document Revised Schedule M specifically requires.
//
// The second had a cause: the self-healing routine built recovered stubs with
// department "QA". That is fixed at source here too, or it recurs.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(ROOT, "public", "app.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "public", "index.html"), "utf8");

/** Run the real applyOneTimeCorrections() over a given set of documents. */
function applyTo(documents) {
  const body = appJs.match(/function applyOneTimeCorrections\(\) \{[\s\S]*?\n  \}/);
  assert.ok(body, "applyOneTimeCorrections should exist");
  const store = { docs: JSON.parse(JSON.stringify(documents)), audit: [], rendered: 0 };
  const ctx = {
    db: {
      getDocuments: () => store.docs,
      saveDocuments: (d) => { store.docs = d; },
      addAuditLog: (user, action, division) => store.audit.push({ user, action, division }),
    },
    touchDoc: (d) => { d.updatedAt = "2026-10-30T12:00:00.000Z"; return d; },
    state: { currentUser: { name: "Sanjiv Kumar Verma" } },
    renderDocumentVault: () => { store.rendered++; },
    rebuildMetrics: () => {},
    console: { log() {}, warn() {} },
  };
  runInNewContext(`${body[0]}\n applyOneTimeCorrections();`, ctx);
  return store;
}

const doc = (id, over = {}) => ({
  id, title: id, category: "SOP", department: "Quality Assurance",
  owner: "Satwinder", version: "00", status: "Approved",
  effectiveDate: "2026-01-01", renewalDate: "2028-01-01",
  history: [{ version: "00", date: "2026-01-01", author: "Ramna", changes: "first issue" }],
  ...over,
});

// ---- (a) ownership passes to Ritika ----------------------------------------

test("every document owned by Ramna passes to Ritika", () => {
  const out = applyTo([doc("A", { owner: "Ramna" }), doc("B", { owner: "Ramna" }), doc("C")]);
  assert.equal(out.docs.filter((d) => d.owner === "Ramna").length, 0);
  assert.equal(out.docs.filter((d) => d.owner === "Ritika").length, 2);
  assert.equal(out.docs.find((d) => d.id === "C").owner, "Satwinder", "nobody else is touched");
});

test("revision history still credits Ramna for the work she did", () => {
  // Ownership is who is answerable now. Authorship is a GMP record and must not
  // be rewritten by a change of owner.
  const out = applyTo([doc("A", { owner: "Ramna" })]);
  assert.equal(out.docs[0].history[0].author, "Ramna");
});

// ---- (b) the documents no hat could see ------------------------------------

test('documents filed under "QA" move to "Quality Assurance"', () => {
  const out = applyTo([doc("VP-QA021", { department: "QA" }), doc("OTHER", { department: "HR" })]);
  assert.equal(out.docs.find((d) => d.id === "VP-QA021").department, "Quality Assurance");
  assert.equal(out.docs.find((d) => d.id === "OTHER").department, "HR", "other departments stay put");
});

test('"QA" is a hat, not a department — the app never offers it as one', () => {
  const opts = indexHtml.match(/id="modal-doc-dept"[\s\S]*?<\/select>/)[0];
  const values = [...opts.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(values.includes("Quality Assurance"), "the real department");
  assert.ok(!values.includes("QA"), "so nothing should ever be filed under it");
});

test("a re-filed document becomes visible to the QA hat", () => {
  // The hat filter matches a document's department against the hat's department.
  const map = appJs.match(/const HAT_DEPARTMENTS = \{([\s\S]*?)\n  \};/)[1];
  const qaDept = map.match(/"QA"\s*:\s*"([^"]+)"/)[1];
  const out = applyTo([doc("VP-QA021", { department: "QA" })]);
  assert.equal(out.docs[0].department, qaDept, "must equal what the QA hat filters on");
});

// ---- both are controlled changes -------------------------------------------

test("each correction is written to the audit log", () => {
  const out = applyTo([doc("A", { owner: "Ramna" }), doc("B", { department: "QA" })]);
  assert.equal(out.audit.length, 2);
  assert.match(out.audit[0].action, /ownership transferred from Ramna to Ritika for 1 document/);
  assert.match(out.audit[0].action, /history is unchanged/i, "say plainly what was NOT changed");
  assert.match(out.audit[1].action, /re-filed .* "QA" to "Quality Assurance"/);
  assert.match(out.audit[1].action, /\bB\b/, "name the documents moved");
});

test("the entry is attributed to the person signed in", () => {
  const out = applyTo([doc("A", { owner: "Ramna" })]);
  assert.equal(out.audit[0].user, "Sanjiv Kumar Verma");
});

// ---- safety ----------------------------------------------------------------

test("both changes stamp updatedAt, so a stale copy cannot undo them", () => {
  const out = applyTo([doc("A", { owner: "Ramna" }), doc("B", { department: "QA" })]);
  for (const d of out.docs) assert.ok(d.updatedAt, `${d.id} must be stamped`);
});

test("running a second time changes nothing and logs nothing", () => {
  const once = applyTo([doc("A", { owner: "Ramna" }), doc("B", { department: "QA" })]);
  const twice = applyTo(once.docs);
  assert.equal(twice.audit.length, 0, "a reload must not write an audit entry every time");
  assert.deepEqual(twice.docs, once.docs);
});

test("nothing to correct means nothing is saved", () => {
  const out = applyTo([doc("A"), doc("B")]);
  assert.equal(out.audit.length, 0);
  assert.equal(out.rendered, 0, "no pointless re-render");
});

test("an empty or unreadable vault is left alone", () => {
  for (const input of [[], null]) {
    assert.doesNotThrow(() => applyTo(input || []));
  }
});

test("only owner and department move — no other field is rewritten", () => {
  const before = [doc("A", { owner: "Ramna" }), doc("B", { department: "QA" })];
  const out = applyTo(before);
  for (let i = 0; i < before.length; i++) {
    const a = { ...before[i] }, b = { ...out.docs[i] };
    for (const k of ["owner", "department", "updatedAt"]) { delete a[k]; delete b[k]; }
    assert.deepEqual(b, a, `${before[i].id}: nothing else should change`);
  }
});

// ---- the cause is fixed, not just the symptom ------------------------------

test("a newly recovered document is filed under a real department", () => {
  const stub = appJs.match(/\/\/ Truly orphan — synthesize stub doc[\s\S]*?\n        \};/);
  assert.ok(stub, "the orphan-recovery stub builder should exist");
  assert.match(stub[0], /department: "Quality Assurance"/,
    "filing a recovered document under the hat name hides it from every hat");
  assert.ok(!/department: "QA"[,\s]/.test(stub[0]), '"QA" must not come back');
});

test("the correction runs after hydration, so it reaches Drive's copy too", () => {
  const callAt = appJs.indexOf("try { applyOneTimeCorrections();");
  const readyAt = appJs.indexOf("await window.__VELITE_READY");
  assert.ok(callAt > readyAt, "running before the Drive pull would correct the wrong copy");
});
