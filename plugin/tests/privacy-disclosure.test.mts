import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

test("shows the v4 privacy disclosure to new and upgraded installs", async () => {
  const main = await readFile(new URL("main.ts", sourceRoot), "utf8");
  const disclosure = await readFile(new URL("upload-consent-modal.ts", sourceRoot), "utf8");

  assert.match(main, /docferry-privacy-security-disclosure-v4/);
  assert.match(disclosure, /publishing or creating a detailed note/);
  assert.match(disclosure, /encrypted while stored on DocFerry servers/);
  assert.match(disclosure, /not end-to-end or zero-knowledge encryption/);
  assert.match(disclosure, /selected public URL is sent to DocFerry/);
  assert.match(disclosure, /public page or available media metadata and captions/);
  assert.match(disclosure, /does not read your browser cookies, history, or profile/);
  assert.match(disclosure, /caption mode does not download the full audio or video/);
  assert.match(disclosure, /temporary detailed-note content is cleared/);
  assert.match(disclosure, /Create note/);
  assert.match(disclosure, /Your account token stays in Obsidian plugin storage/);
  assert.match(disclosure, /https:\/\/docferry\.bondie\.io\/privacy/);
});
