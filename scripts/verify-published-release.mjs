import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
assert.equal(manifest.id, "docferry");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
const repo = "fyaic/Docferry-Obsidian-Plugin";
const release = JSON.parse(execFileSync("gh", [
  "api", `repos/${repo}/releases/tags/${manifest.version}`
], { encoding: "utf8" }));
assert.equal(release.tag_name, manifest.version);
assert.equal(release.draft, false, "Community cannot install a draft release");
assert.equal(release.prerelease, false);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const name of ["main.js", "manifest.json", "styles.css"]) {
  const matches = release.assets.filter((asset) => asset.name === name);
  assert.equal(matches.length, 1, `Expected one ${name} release asset`);
  const asset = matches[0];
  assert.equal(asset.state, "uploaded");
  assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0);
  const bytes = execFileSync("gh", [
    "api", `repos/${repo}/releases/assets/${asset.id}`,
    "-H", "Accept: application/octet-stream"
  ], { maxBuffer: 16 * 1024 * 1024 });
  const local = readFileSync(name === "manifest.json" ? name : "plugin/" + name);
  assert.equal(hash(bytes), hash(local), `Published ${name} differs from verified build`);
  if (asset.digest) assert.equal(asset.digest, "sha256:" + hash(bytes));
  if (name === "manifest.json") assert.deepEqual(JSON.parse(bytes.toString("utf8")), manifest);
  console.log(`${hash(bytes)}  ${name}`);
}
console.log(`Published release verified: ${repo} ${manifest.version} (${manifest.id})`);
