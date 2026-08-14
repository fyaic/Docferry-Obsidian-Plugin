import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";


const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const rootManifest = json("manifest.json");
const pluginManifest = json("plugin/manifest.json");
const rootVersions = json("versions.json");
const pluginVersions = json("plugin/versions.json");
const rootPackage = json("package.json");
const pluginPackage = json("plugin/package.json");

assert(rootManifest.id === "docferry", "The existing Community plugin id must remain docferry");
assert(JSON.stringify(rootManifest) === JSON.stringify(pluginManifest), "Root and plugin manifests differ");
assert(JSON.stringify(rootVersions) === JSON.stringify(pluginVersions), "Root and plugin version maps differ");
assert(/^\d+\.\d+\.\d+$/.test(rootManifest.version), "Manifest version is not SemVer x.y.z");
assert(rootManifest.version === rootPackage.version, "Root package version differs from manifest");
assert(rootManifest.version === pluginPackage.version, "Plugin package version differs from manifest");
assert(rootVersions[rootManifest.version] === rootManifest.minAppVersion, "Version map is missing this release");
assert(rootManifest.author === "Bondie", "Public manifest must use current product authorship");
assert(rootManifest.authorUrl === "https://bondie.io", "Public manifest author URL is stale");
assert(rootManifest.isDesktopOnly === true, "This release must remain desktop-only");
assert(!/obsidian/i.test(rootManifest.description), "Manifest description must not include Obsidian");
assert(rootPackage.license === "MIT", "Public client source must retain the intentional MIT license");
assert(pluginPackage.license === "MIT", "Packaged client source must retain the intentional MIT license");
assert(statSync(join(root, "LICENSE")).isFile(), "LICENSE is missing");
assert(statSync(join(root, `release-notes/${rootManifest.version}.md`)).isFile(), "Release notes are missing");

const currentText = [
  read("README.md"),
  read("PRIVACY.md"),
  read("SECURITY.md"),
  read("SUPPORT.md"),
  read("plugin/README.md"),
  read("plugin/src/settings.ts"),
  read("plugin/main.js"),
  read(`release-notes/${rootManifest.version}.md`)
].join("\n");
assert(currentText.includes("https://docferry.bondie.io"), "Current service URL is not documented");
assert(!currentText.includes("fuyonder.tech"), "Retired service domain leaked into current release surfaces");
const openRouterPrefix = ["sk", "or", "v1", ""].join("-");
const developerHome = ["", "Users", "veil"].join("/");
const privateKeyMarker = ["BEGIN", "PRIVATE", "KEY"].join(" ");
assert(!currentText.includes(openRouterPrefix), "OpenRouter credential leaked into public release surfaces");
assert(!currentText.includes(developerHome), "Developer-local path leaked into public release surfaces");
assert(!currentText.includes(privateKeyMarker), "Private key leaked into public release surfaces");

for (const forbidden of ["server", "ops", "media-worker", "agent-kit"]) {
  try {
    statSync(join(root, forbidden));
    throw new Error(`Private implementation directory must not be public: ${forbidden}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Private implementation")) throw error;
  }
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}

const reviewFiles = (await walk(root)).filter((path) => {
  const name = relative(root, path);
  return !name.startsWith("docs/archive/") && !name.startsWith("release-notes/0.0.4");
});
const secretPatterns = [
  new RegExp("s" + "k-[A-Za-z0-9_-]{20,}"),
  new RegExp("g" + "hp_[A-Za-z0-9]{20,}"),
  new RegExp("BEGIN (?:RSA |OPENSSH |EC )?" + "PRIVATE KEY"),
  new RegExp("/Users/" + "veil")
];
for (const path of reviewFiles) {
  if (statSync(path).size > 2_000_000) continue;
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const pattern of secretPatterns) {
    assert(!pattern.test(content), `Sensitive value pattern found in ${relative(root, path)}`);
  }
}

console.log(`DocFerry ${rootManifest.version} public release gate passed (${reviewFiles.length} files scanned).`);
