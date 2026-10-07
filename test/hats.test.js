// A hat is defined in two files: the HAT_DEPARTMENTS map in public/app.js and
// the <option> list in public/index.html. It used to be defined in three places
// inside app.js as well, which is how they drifted. These tests read both files
// and assert they still agree, so adding a hat to one and forgetting the other
// fails here rather than silently producing a hat that filters nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appJs = readFileSync(join(ROOT, "app.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");

/** The HAT_DEPARTMENTS object literal from app.js, as real data. */
function hatDepartments() {
  const m = appJs.match(/const HAT_DEPARTMENTS = \{([\s\S]*?)\n  \};/);
  assert.ok(m, "HAT_DEPARTMENTS should be a single object literal in app.js");
  const map = {};
  for (const [, hat, dept] of m[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) map[hat] = dept;
  return map;
}

/** The value="" list of a <select> in index.html. */
function selectOptions(id) {
  const block = indexHtml.match(new RegExp(`id="${id}"[\\s\\S]*?</select>`));
  assert.ok(block, `a <select id="${id}"> should exist in index.html`);
  return [...block[0].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
}

const EXPECTED_HATS = [
  "Production", "QC", "QA", "HR", "Microbiology", "Warehouse", "Engineering",
];

// ---- the hats themselves ---------------------------------------------------

test("every hat the dropdown offers has a department behind it", () => {
  const map = hatDepartments();
  for (const hat of selectOptions("operator-hat-select")) {
    if (hat === "CEO") continue; // CEO means "no filter" and has no entry by design
    assert.ok(map[hat], `the ${hat} hat is in the dropdown but missing from HAT_DEPARTMENTS`);
  }
});

test("every hat with a department is offered in the dropdown", () => {
  const options = selectOptions("operator-hat-select");
  for (const hat of Object.keys(hatDepartments())) {
    assert.ok(options.includes(hat), `the ${hat} hat is mapped but not offered in the dropdown`);
  }
});

test("the CEO hat stays out of the map, so it filters nothing", () => {
  assert.ok(!("CEO" in hatDepartments()), "a CEO entry would filter the unfiltered view");
  assert.ok(selectOptions("operator-hat-select").includes("CEO"), "CEO must still be selectable");
});

test("the three new hats are present", () => {
  const map = hatDepartments();
  assert.equal(map.Microbiology, "Microbiology");
  assert.equal(map.Warehouse, "Warehouse");
  assert.equal(map.Engineering, "Engineering");
});

test("no hat was lost", () => {
  assert.deepEqual(Object.keys(hatDepartments()).sort(), [...EXPECTED_HATS].sort());
});

// ---- hats need documents to filter to --------------------------------------

test("every hat's department can be assigned to a document", () => {
  const docDepts = selectOptions("modal-doc-dept");
  for (const [hat, dept] of Object.entries(hatDepartments())) {
    assert.ok(
      docDepts.includes(dept),
      `the ${hat} hat filters to "${dept}", but no document can be given that department ` +
      `— the hat would always show an empty vault`
    );
  }
});

// ---- the consolidation holds ----------------------------------------------

test("hat departments are defined once, not copied per filter site", () => {
  const inlineCopies = appJs.match(/hatDeptMap = \{/g) || [];
  assert.equal(
    inlineCopies.length, 0,
    "a hat-to-department object literal was reintroduced; use HAT_DEPARTMENTS so the hats cannot drift"
  );
  assert.ok(appJs.includes("const hatDeptMap = HAT_DEPARTMENTS;"), "filter sites should read the shared map");
});

test("filing a document is allowed for HR and the login-less hats, and nobody else", () => {
  const m = appJs.match(/const DOC_FILING_DEPARTMENTS = \[([^\]]*)\]/);
  assert.ok(m, "DOC_FILING_DEPARTMENTS should be a single list");
  const depts = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(depts.sort(), ["Engineering", "HR", "Microbiology", "Warehouse"]);
  // Guard the thing we promised: QC and Production gain nothing here.
  assert.ok(!depts.includes("Quality Control"), "QC must not gain document filing");
  assert.ok(!depts.includes("Production"), "Production must not gain document filing");
});

test("the genuinely QA-only tools are still QA-only", () => {
  for (const id of ["btn-bulk-tag", "btn-recently-deleted"]) {
    const btn = indexHtml.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(btn, `${id} should exist`);
    assert.match(btn[0], /qa-only-btn/, `${id} must stay restricted to QA and Executive`);
  }
  const create = indexHtml.match(/<button[^>]*id="btn-create-sop"[^>]*>/);
  assert.match(create[0], /doc-create-btn/, "Create New Document uses the wider filing gate");
  assert.ok(!/qa-only-btn/.test(create[0]), "Create New Document should not carry both gates");
});
