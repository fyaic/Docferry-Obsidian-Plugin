import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("keeps root and packaged Obsidian release metadata synchronized", async () => {
  const rootManifest = await readJson("../../manifest.json");
  const pluginManifest = await readJson("../manifest.json");
  const rootVersions = await readJson("../../versions.json");
  const pluginVersions = await readJson("../versions.json");

  assert.equal(rootManifest.id, "docferry");
  assert.deepEqual(rootManifest, pluginManifest);
  assert.deepEqual(rootVersions, pluginVersions);
  assert.equal(rootVersions[String(pluginManifest.version)], pluginManifest.minAppVersion);
});
