// "Site Master File — Expiring/Overdue — date is not editable."
//
// The date was always editable; the dashboard the QA team was clicking on was
// not. The Expiring / Overdue tile and the Urgent Quality Actions rows were
// plain markup with no handler, so clicking the overdue document did nothing,
// and the renewal date field's calendar button was drawn as a near-black glyph
// on a near-black field because the stylesheet never declared a dark colour
// scheme — present, clickable, invisible.
//
// These tests pin both halves: the dashboard navigates, and the date control is
// visible and unlocked.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appJs = readFileSync(join(ROOT, "app.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
const styleCss = readFileSync(join(ROOT, "style.css"), "utf8");

// ---- the renewal date must be editable, and must look it -------------------

test("the renewal date field is never disabled", () => {
  const field = indexHtml.match(/<input[^>]*id="modal-doc-rendate"[^>]*>/);
  assert.ok(field, "the Edit SOP modal should have a renewal date field");
  assert.ok(!/\bdisabled\b/.test(field[0]), "the renewal date must stay editable");
  assert.match(field[0], /type="date"/);

  // Only the document ID is locked while editing an existing document.
  const opener = appJs.match(/window\.openDocumentModal = function[\s\S]*?\n  \};/);
  assert.ok(opener, "openDocumentModal should exist");
  const locked = [...opener[0].matchAll(/getElementById\("([^"]+)"\)\.disabled = true/g)].map((m) => m[1]);
  assert.deepEqual(locked, ["modal-doc-id"], "nothing but the document ID should be locked");
});

test("the app declares a dark colour scheme, so native date controls are drawn for it", () => {
  // Without this the browser renders the calendar button in light mode: a dark
  // glyph on a dark field, which reads as "this date cannot be changed".
  assert.match(styleCss, /:root\s*\{[\s\S]*?color-scheme:\s*dark/,
    "color-scheme: dark should be declared on :root");
});

test("the calendar button is not filtered back into invisibility", () => {
  // Under color-scheme: dark the browser already draws this glyph white.
  // Inverting it to "brighten" it turns it black again — verified by screenshot
  // in Chromium — which is the exact bug this change exists to fix.
  const rule = styleCss.match(/::-webkit-calendar-picker-indicator\s*\{[^}]*\}/g) || [];
  for (const r of rule) {
    assert.ok(!/filter\s*:/.test(r), `the picker indicator must not be filtered: ${r}`);
  }
  assert.match(styleCss, /\.input-glass\[type="date"\]\s*\{[\s\S]*?cursor:\s*pointer/,
    "a date field should show a pointer so it reads as changeable");
});

test("the custom renewal date in the Renew wizard is a real date field too", () => {
  const field = indexHtml.match(/<input[^>]*id="renew-custom-date"[^>]*>/);
  assert.ok(field, "the Renew tab should offer a manual date");
  assert.match(field[0], /type="date"/);
  assert.ok(!/\bdisabled\b/.test(field[0]));
  assert.match(indexHtml, /<option value="custom">/, "the dropdown should offer setting a date by hand");
});

// ---- the dashboard has to lead somewhere -----------------------------------

test("an urgent document on the dashboard opens that document", () => {
  const lists = appJs.match(/function renderDashboardLists\(\)[\s\S]*?\n  \}\n/);
  assert.ok(lists, "renderDashboardLists should exist");
  assert.match(lists[0], /onclick="openDocFromDashboard\(/,
    "each Urgent Quality Actions row should open its document");
  assert.match(lists[0], /cursor:pointer/, "and should look clickable");
});

test("the Expiring / Overdue tile opens the vault, in both divisions", () => {
  const metrics = appJs.match(/function rebuildMetrics\(\)[\s\S]*?\n  \}\n/);
  assert.ok(metrics, "rebuildMetrics should exist");
  const tiles = [...metrics[0].matchAll(/<div class="kpi-card[^"]*"[^>]*>(?:(?!<\/div>).)*?Expiring \/ Overdue/g)];
  assert.equal(tiles.length, 2, "Pharmaceuticals and Healthcare each have the tile");
  for (const tile of tiles) {
    assert.match(tile[0], /onclick="showUrgentDocuments\(\)"/, "the tile should be clickable");
  }
});

test("both dashboard handlers exist and land in the Document Vault", () => {
  const open = appJs.match(/window\.openDocFromDashboard = function[\s\S]*?\n  \};/);
  assert.ok(open, "openDocFromDashboard should be defined on window for the inline handler");
  assert.match(open[0], /switchTab\("documents"\)/, "it should switch to the vault");
  assert.match(open[0], /openDocumentModal\(docId\)/, "and open that document for editing");
  assert.match(open[0], /showNotification/, "a document the user cannot see should say so, not fail silently");

  const urgent = appJs.match(/window\.showUrgentDocuments = function[\s\S]*?\n  \};/);
  assert.ok(urgent, "showUrgentDocuments should be defined on window");
  assert.match(urgent[0], /switchTab\("documents"\)/);
  assert.match(urgent[0], /search.value = ""/, "it should clear any leftover search first");
});

test("a document id with a quote in it cannot break the inline handler", () => {
  // The ids in the vault contain slashes (VP/SMF/01). An apostrophe would end
  // the attribute's string literal, so ids are escaped on the way in.
  assert.match(appJs, /const jsAttr = /, "there should be an escaping helper");
  const lists = appJs.match(/function renderDashboardLists\(\)[\s\S]*?\n  \}\n/);
  assert.match(lists[0], /openDocFromDashboard\('\$\{jsAttr\(d\.id\)\}'\)/,
    "the id must be escaped before it goes into the onclick attribute");
});

// ---- making the rows actionable must not widen what HR can reach -----------

test("the dashboard list is scoped to HR's own documents, like the tiles and the vault", () => {
  // Before the rows were clickable this was a display leak; now it would be a
  // way into another department's documents.
  const lists = appJs.match(/function renderDashboardLists\(\)[\s\S]*?\n  \}\n/);
  assert.match(lists[0], /!== "HR" \|\| d\.department === "HR"/,
    "renderDashboardLists should apply the same HR scope as rebuildMetrics");
  const filtered = lists[0].match(/db\.getDocuments\(\)\.filter\([^\n]*/);
  assert.ok(filtered, "the document list should be filtered");
  assert.match(filtered[0], /matchesOwnDeptDoc/);
});
