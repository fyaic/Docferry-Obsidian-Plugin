import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// The Obsidian build verification expects the built plugin entry at the
// repository root or in dist/, build/, or out/. The plugin bundles into
// plugin/main.js, so stage the release artifacts into dist/ after the build.
const root = process.cwd();
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

for (const [from, to] of [
  ["plugin/main.js", "dist/main.js"],
  ["plugin/styles.css", "dist/styles.css"],
  ["manifest.json", "dist/manifest.json"]
]) {
  copyFileSync(join(root, from), join(root, to));
}

console.log("Staged build artifacts into dist/ (main.js, styles.css, manifest.json).");
