// The AI drawer's static markup stated findings the app had never made: a
// completed system check, a named overdue document (SPEC-QC-088, which is not
// in this vault), a vector count, a count of banned-ingredient rules and an
// accuracy rating — all fixed text in index.html.
//
// On a GMP screen a stated finding is a claim. Anything the panel shows has to
// either come from the live data or read plainly as "nothing yet".

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appJs = readFileSync(join(ROOT, "app.js"), "utf8");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");

/** The ingredient compliance rules the app actually ships. */
function ingredientRuleCount() {
  const mockData = readFileSync(join(ROOT, "data", "mockData.js"), "utf8");
  const start = mockData.indexOf("[", mockData.indexOf("const ingredientDatabase"));
  let depth = 0, end = start;
  for (let i = start; i < mockData.length; i++) {
    if (mockData[i] === "[") depth++;
    else if (mockData[i] === "]" && --depth === 0) { end = i + 1; break; }
  }
  return (mockData.slice(start, end).match(/\{\s*name:/g) || []).length;
}

test("no document is named as overdue in fixed page text", () => {
  // SPEC-QC-088 and FORM-QC-102 are not in this vault and never were.
  for (const ghost of ["SPEC-QC-088", "FORM-QC-102"]) {
    assert.ok(!indexHtml.includes(ghost), `index.html still names ${ghost}`);
  }
});

test("the recommendations panel does not claim a check that has not run", () => {
  const panel = indexHtml.match(/id="ai-suggestions-list"[\s\S]*?\n          <\/div>/);
  assert.ok(panel, "the suggestions list should exist");
  assert.ok(!/System Check Complete/.test(panel[0]),
    "the placeholder must not announce a completed system check");
  assert.match(panel[0], /No system check run yet/,
    "it should say plainly that nothing has run");
});

test("the vector counts are placeholders, filled from the live vectorbase", () => {
  // Both showed a hardcoded 2 — the two prototype vectors, now removed.
  const inline = indexHtml.match(/id="ai-vector-count"[^>]*>([^<]*)</);
  const stat = indexHtml.match(/id="ai-stat-vectors"[^>]*>([^<]*)</);
  assert.ok(inline && stat, "both vector readouts should exist");
  for (const [, text] of [inline, stat]) {
    assert.ok(!/\d/.test(text), `a vector count must not be hardcoded in markup: "${text}"`);
  }
  const update = appJs.match(/function updateAiStats\(\)[\s\S]*?\n  \}/);
  assert.ok(update, "updateAiStats should exist");
  assert.match(update[0], /ai-vector-count/);
  assert.match(update[0], /ai-stat-vectors/);
});

test("the banned-rule figure is read from the ingredient database, not asserted", () => {
  const stat = indexHtml.match(/id="ai-stat-banned"[^>]*>([^<]*)</);
  assert.ok(stat, "the readout should have an id so it can be filled");
  assert.ok(!/\d/.test(stat[1]), `must not be hardcoded in markup: "${stat[1]}"`);
  assert.ok(!indexHtml.includes("26 Banned"),
    "the old figure claimed 26 rules; there are not 26");

  const update = appJs.match(/function updateAiStats\(\)[\s\S]*?\n  \}/);
  assert.match(update[0], /ai-stat-banned/, "updateAiStats should fill it");
  assert.match(update[0], /getIngredientDB/, "from the real ingredient database");
});

test("the real rule count is nowhere near the figure that was being shown", () => {
  // Guards the claim in the commit, and fails loudly if the database grows to
  // the point where someone might think 26 was right all along.
  const n = ingredientRuleCount();
  assert.ok(n > 0, "the ingredient database should have entries");
  assert.notEqual(n, 26, "if this ever becomes 26, revisit the test above, not the fix");
});

test("updateAiStats survives an empty or unreadable vectorbase", () => {
  // Removing both prototype vectors leaves the store at []; a browser that has
  // never synced can have nothing there at all.
  const update = appJs.match(/function updateAiStats\(\)[\s\S]*?\n  \}/);
  assert.match(update[0], /db\.getAiKnowledge\(\) \|\| \[\]/,
    "a null vectorbase must not throw on .length");
});

test("the stats pane shows no figure that is not read from the live data", () => {
  // This is the general rule the SPEC-QC-088 line, the hardcoded vector counts,
  // the "26 Banned" rule count and the 99.8% accuracy rating all broke. Each
  // readout must carry an id that updateAiStats() fills, and must not ship a
  // value baked into the markup.
  const pane = indexHtml.match(/<div class="ai-stats-pane">[\s\S]*?\n        <\/div>/);
  assert.ok(pane, "the stats pane should exist");

  const update = appJs.match(/function updateAiStats\(\)[\s\S]*?\n  \}/)[0];
  const readouts = [...pane[0].matchAll(/<strong([^>]*)>([^<]*)<\/strong>/g)];
  assert.ok(readouts.length > 0, "there should be at least one readout");

  for (const [, attrs, text] of readouts) {
    const id = attrs.match(/id="([^"]+)"/);
    assert.ok(id, `every readout needs an id so it can be filled: "${text}"`);
    assert.ok(!/\d/.test(text), `"${text}" is baked into the markup, not read from data`);
    assert.ok(update.includes(id[1]), `updateAiStats() does not fill ${id[1]}`);
  }
});

test("the accuracy rating is gone, not just blanked", () => {
  // Nothing in the app measures accuracy, so there is no honest value to show.
  // A claim like this is what an auditor asks you to substantiate.
  assert.ok(!/99\.8/.test(indexHtml.replace(/<!--[\s\S]*?-->/g, "")),
    "the 99.8% figure must not appear in the markup");
  assert.ok(!indexHtml.includes("<span>Accuracy Rating</span>"),
    "the readout itself should be removed, not left empty");
});

test("the stats pane lays out for however many readouts it has", () => {
  // It was a fixed three-column grid; removing a readout would have left a hole.
  const styleCss = readFileSync(join(ROOT, "style.css"), "utf8");
  const rule = styleCss.match(/\.ai-stats-pane \{[^}]*\}/);
  assert.ok(rule, "the stats pane should have a layout rule");
  assert.ok(!/grid-template-columns:\s*1fr 1fr 1fr/.test(rule[0]),
    "a fixed three-column grid no longer matches the number of readouts");
  assert.match(rule[0], /grid-template-columns:\s*repeat\(auto-fit/);
});
