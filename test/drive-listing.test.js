// The metadata folder holds one doc-{id}.json per document — about 930 of them,
// plus duplicates. It was listed with a single 1000-item request and no paging,
// so once the folder passed that size the listing was silently short.
//
// A short listing is wrong in two ways that both cost data:
//   - /api/data/pull?docMeta=1 stops returning some documents' metadata
//   - migrateLocalDocsToDriveMeta concludes those documents have no metadata
//     file and writes a fresh one from whatever that browser happens to hold
//
// That is how VP-QA006 came to have four copies of doc-VP-QA006.json, one of
// which kept republishing a renewal date the QA manager had already corrected.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "drive.js");
const driveJs = readFileSync(SRC, "utf8");

/** Run the real listFolderContentsById against a fake Drive of `total` files. */
function listAgainst(total, pageSize = 1000) {
  const body = driveJs.match(/export async function listFolderContentsById\(folderId\) \{[\s\S]*?\n\}/);
  assert.ok(body, "listFolderContentsById should exist");

  const calls = [];
  const files = Array.from({ length: total }, (_, i) => ({ id: `f${i}`, name: `doc-D${i}.json` }));
  const ctx = {
    calls,
    getDrive: () => ({
      files: {
        list: async (params) => {
          calls.push(params);
          const start = params.pageToken ? Number(params.pageToken) : 0;
          const end = Math.min(start + pageSize, files.length);
          return {
            data: {
              files: files.slice(start, end),
              nextPageToken: end < files.length ? String(end) : undefined,
            },
          };
        },
      },
    }),
    result: null,
  };
  const src = body[0].replace(/^export /, "");
  runInNewContext(`${src}; result = listFolderContentsById("folder-id");`, ctx);
  return ctx.result.then((r) => ({ files: r, calls }));
}

test("a folder that fits in one page is returned in one request", async () => {
  const { files, calls } = await listAgainst(300);
  assert.equal(files.length, 300);
  assert.equal(calls.length, 1);
});

test("a folder larger than one page is followed to the end", async () => {
  // This is the case the metadata folder is in now.
  const { files, calls } = await listAgainst(2350);
  assert.equal(files.length, 2350, "every file must be listed, not just the first page");
  assert.equal(calls.length, 3);
  assert.equal(new Set(files.map((f) => f.id)).size, 2350, "no duplicates across pages");
});

test("exactly one full page does not loop forever", async () => {
  const { files, calls } = await listAgainst(1000);
  assert.equal(files.length, 1000);
  assert.equal(calls.length, 1, "no token means no second request");
});

test("an empty folder returns nothing rather than throwing", async () => {
  const { files, calls } = await listAgainst(0);
  // Built inside the sandbox, so compare contents rather than realms.
  assert.equal(files.length, 0);
  assert.equal(calls.length, 1);
});

test("the page token is passed back on each follow-up request", async () => {
  const { calls } = await listAgainst(2350);
  assert.equal(calls[0].pageToken, undefined, "the first request has no token");
  assert.equal(calls[1].pageToken, "1000");
  assert.equal(calls[2].pageToken, "2000");
  for (const c of calls) {
    assert.match(c.fields, /nextPageToken/, "the token has to be requested or paging cannot work");
  }
});
