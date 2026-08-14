import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("opens web login and product links in the operating-system browser", async () => {
  const source = await readFile(new URL("../src/external-links.ts", import.meta.url), "utf8");

  assert.match(source, /from "electron"/);
  assert.match(source, /shell\.openExternal/);
  assert.match(source, /url\.protocol !== "https:"/);
  assert.doesNotMatch(source, /url\.protocol !== "http:"/);
  assert.doesNotMatch(source, /window\.open/);
  assert.doesNotMatch(source, /ObsidianRuntime/);
});
