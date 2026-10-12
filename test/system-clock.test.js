// The app used to carry a frozen clock: `const TODAY = new Date("2026-05-24")`,
// plus the same literal hardcoded in twelve other places. Two things broke.
//
// Renewal urgency was measured against a date in the past, so the dashboard's
// Expiring / Overdue figure stopped moving — on 12 Oct 2026 it reported 1 when
// the true figure was 119. And every record the app stamped (version history,
// effective dates, deviation dates, stability start dates) carried 24 May,
// which breaks the ALCOA+ requirement that a GMP record is contemporaneous.
//
// These tests run the real clock helpers and the real urgency rule out of
// public/app.js, against a controlled "today".

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const appJs = readFileSync(join(ROOT, "app.js"), "utf8");

/** Pull a top-level `function name(...) { ... }` block out of app.js verbatim. */
function extract(name) {
  const m = appJs.match(new RegExp(`\\n  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `${name}() should be a plain function declaration in app.js`);
  return m[0];
}

/**
 * Run the clock helpers and getRenewalUrgency with `new Date()` pinned to the
 * given local calendar date. The fake is built from local components so the
 * test gives the same answer in every timezone.
 */
function atDate(y, mo, d, fn) {
  const Real = Date;
  class FakeDate extends Real {
    constructor(...args) {
      if (args.length === 0) super(y, mo - 1, d, 9, 30, 0); // local, mid-morning
      else super(...args);
    }
    static now() { return new FakeDate().getTime(); }
  }
  const ctx = { Date: FakeDate, window: {}, console };
  runInNewContext(
    `${extract("todayISO")}\n${extract("todayDate")}\n${extract("todayYear")}\n${extract("getRenewalUrgency")}
     window.out = { todayISO, todayDate, todayYear, getRenewalUrgency };`,
    ctx
  );
  return fn(ctx.window.out);
}

const label = (api, date) => api.getRenewalUrgency(date).label;

// ---- the clock reads the real date ----------------------------------------

test("no hardcoded prototype date survives anywhere in the app", () => {
  // This is the regression guard. Any one of these literals coming back
  // re-freezes whichever part of the app it sits in.
  for (const frozen of ["2026-05-24", "2028-05-24", "2026-06-07"]) {
    assert.ok(!appJs.includes(frozen), `app.js still hardcodes ${frozen}`);
  }
  assert.ok(!/\bTODAY\b/.test(appJs), "the frozen TODAY constant should be gone");
});

test("todayISO reports the real calendar date", () => {
  atDate(2026, 10, 12, (api) => assert.equal(api.todayISO(), "2026-10-12"));
  atDate(2027, 1, 1, (api) => assert.equal(api.todayISO(), "2027-01-01"));
});

test("single-digit months and days are zero-padded, so the string sorts and parses", () => {
  atDate(2027, 3, 7, (api) => assert.equal(api.todayISO(), "2027-03-07"));
});

test("the date comes from the local calendar, not from UTC", () => {
  // The team is in India (UTC+5:30). Just after local midnight, toISOString()
  // would still report the previous day and every record stamped between
  // midnight and 05:30 would be dated a day early.
  const Real = Date;
  const prevTZ = process.env.TZ;
  try {
    process.env.TZ = "Asia/Kolkata";
    class FakeDate extends Real {
      constructor(...args) {
        if (args.length === 0) super("2026-10-12T00:30:00+05:30");
        else super(...args);
      }
      static now() { return new FakeDate().getTime(); }
    }
    const ctx = { Date: FakeDate, window: {}, console };
    runInNewContext(`${extract("todayISO")}\nwindow.iso = todayISO();`, ctx);
    const naive = new FakeDate().toISOString().split("T")[0];
    assert.equal(naive, "2026-10-11", "precondition: UTC is still on the previous day");
    assert.equal(ctx.window.iso, "2026-10-12", "the record must carry the local date");
  } finally {
    if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  }
});

test("todayDate lines up with how stored renewal dates parse", () => {
  atDate(2026, 10, 12, (api) => {
    assert.equal(api.todayDate().getTime(), new Date("2026-10-12").getTime());
  });
});

test("todayYear is used for new record numbering, so IDs do not stay in 2026", () => {
  atDate(2028, 2, 9, (api) => assert.equal(api.todayYear(), 2028));
  assert.match(appJs, /DEV-\$\{todayYear\(\)\}-/, "deviation IDs should carry the real year");
  assert.match(appJs, /STAB-\$\{todayYear\(\)\}-/, "stability study IDs should carry the real year");
});

// ---- renewal urgency moves with the clock ----------------------------------

test("a document due tomorrow is Expiring Soon, not Overdue", () => {
  atDate(2026, 10, 12, (api) => assert.equal(label(api, "2026-10-13"), "Expiring Soon"));
});

test("a document due today has not lapsed yet", () => {
  atDate(2026, 10, 12, (api) => assert.equal(label(api, "2026-10-12"), "Expiring Soon"));
});

test("a document due yesterday is Overdue", () => {
  atDate(2026, 10, 12, (api) => assert.equal(label(api, "2026-10-11"), "Overdue"));
});

test("the 60-day warning window is measured from the real date", () => {
  atDate(2026, 10, 12, (api) => {
    assert.equal(label(api, "2026-12-11"), "Expiring Soon", "60 days out is inside the window");
    assert.equal(label(api, "2026-12-12"), "Active", "61 days out is not yet urgent");
  });
});

test("a document with no renewal cycle is not reported as urgent", () => {
  atDate(2026, 10, 12, (api) => {
    assert.equal(label(api, ""), "No renewal");
    assert.equal(label(api, null), "No renewal");
    assert.equal(label(api, undefined), "No renewal");
    assert.equal(label(api, "not a date"), "No renewal");
  });
});

// ---- the regression this fix exists for ------------------------------------

test("the same document changes urgency as time passes", () => {
  // VP-QA006 SITE MASTER FILE, renewal 2026-03-04. Under the frozen clock the
  // dashboard called this the only urgent document in the vault, for months.
  const smf = "2026-03-04";
  atDate(2026, 1, 10, (api) => assert.equal(label(api, smf), "Expiring Soon"));
  atDate(2026, 3, 5, (api) => assert.equal(label(api, smf), "Overdue"));
  atDate(2026, 10, 12, (api) => assert.equal(label(api, smf), "Overdue"));

  // VP/SMF/01, renewal 2026-08-27. Frozen at 24 May this read Active and the
  // team was never told it had lapsed.
  const smf01 = "2026-08-27";
  atDate(2026, 5, 24, (api) => assert.equal(label(api, smf01), "Active"));
  atDate(2026, 10, 12, (api) => assert.equal(label(api, smf01), "Overdue",
    "a document that lapsed in August must show as Overdue in October"));
});

test("documents stamped by a renewal carry today's date", () => {
  // The renewal path used to write effectiveDate = "2026-05-24" and a version
  // history line dated 24 May, whenever it actually ran.
  const renew = appJs.match(/window\.executeDocumentRenewal = function[\s\S]*?\n  \};/);
  assert.ok(renew, "executeDocumentRenewal should exist");
  assert.match(renew[0], /effectiveDate = todayISO\(\)/, "effective date must be the real date");
  assert.match(renew[0], /date: todayISO\(\)/, "the history entry must be the real date");
});
