import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("external URL parsing and browser handoff failures resolve without an unhandled rejection", async () => {
  const source = await readFile(new URL("../src/external-links.ts", import.meta.url), "utf8");
  const tryIndex = source.indexOf("try {");
  assert.ok(tryIndex >= 0);
  assert.ok(source.indexOf("new URL(value)") > tryIndex);
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /return false/);
});
