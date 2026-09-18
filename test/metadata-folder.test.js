import test from "node:test";
import assert from "node:assert/strict";
import { getMetadataFolderId, METADATA_FOLDER_NAME } from "../src/drive.js";

const PINNED = "1pvU4RNDJkgpWwrOAlpk_QzPIuzZfO5GN";

function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "GOOGLE_METADATA_FOLDER_ID");
  const prev = process.env.GOOGLE_METADATA_FOLDER_ID;
  if (value === undefined) delete process.env.GOOGLE_METADATA_FOLDER_ID;
  else process.env.GOOGLE_METADATA_FOLDER_ID = value;
  try {
    return fn();
  } finally {
    if (had) process.env.GOOGLE_METADATA_FOLDER_ID = prev;
    else delete process.env.GOOGLE_METADATA_FOLDER_ID;
  }
}

test("a pinned folder id is used as-is, with no name lookup", async () => {
  const id = await withEnv(PINNED, () => getMetadataFolderId());
  assert.equal(id, PINNED);
});

test("surrounding whitespace in the pinned id is trimmed", async () => {
  const id = await withEnv(`  ${PINNED}\n`, () => getMetadataFolderId());
  assert.equal(id, PINNED);
});

// Without the pin we must fall through to the name lookup. With no Google
// credentials configured that call throws — which is exactly the proof that
// the fallback path ran rather than something being returned from the env.
test("an unset pin falls back to the name lookup", async () => {
  await assert.rejects(
    () => withEnv(undefined, () => getMetadataFolderId()),
    /GOOGLE_CLIENT_ID|GOOGLE_SHARED_FOLDER_ID/,
    "should have attempted a Drive lookup"
  );
});

test("an empty or whitespace-only pin is ignored, not used as an id", async () => {
  for (const blank of ["", "   "]) {
    await assert.rejects(
      () => withEnv(blank, () => getMetadataFolderId()),
      /GOOGLE_CLIENT_ID|GOOGLE_SHARED_FOLDER_ID/,
      `blank pin ${JSON.stringify(blank)} must not be treated as a folder id`
    );
  }
});

// The name is only a fallback, but when it is used it must match the real
// folder exactly — including the em-dash, which is easy to lose to a hyphen.
test("the fallback folder name is the exact em-dash spelling", () => {
  assert.equal(METADATA_FOLDER_NAME, "Velite QA Nexus — Metadata");
  assert.ok(METADATA_FOLDER_NAME.includes("—"), "must use an em-dash, not a hyphen");
  assert.ok(!METADATA_FOLDER_NAME.includes(" - "), "must not use a plain hyphen");
});
