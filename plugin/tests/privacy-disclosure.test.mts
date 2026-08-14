import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

test("shows the v7 managed media privacy disclosure to new and upgraded installs", async () => {
  const main = await readFile(new URL("main.ts", sourceRoot), "utf8");
  const disclosure = await readFile(new URL("upload-consent-modal.ts", sourceRoot), "utf8");

  assert.match(main, /docferry-privacy-security-disclosure-v7/);
  assert.match(disclosure, /only when you choose to share or save a public link/);
  assert.match(disclosure, /stored content is encrypted on DocFerry servers/);
  assert.match(disclosure, /not end-to-end or zero-knowledge encryption/);
  assert.match(disclosure, /Saving a supported public link sends its URL/);
  assert.match(disclosure, /public YouTube URL or bounded audio or video content/);
  assert.match(disclosure, /through OpenRouter to a server-selected AI model/);
  assert.match(disclosure, /selected model provider process that input/);
  assert.match(disclosure, /does not send your Bondie identity, browser cookies, history, profile, or other vault files/);
  assert.match(disclosure, /Temporary import content is cleared/);
  assert.match(disclosure, /Before DocFerry prepares this link/);
  assert.match(disclosure, /Your account token stays in this plugin on this device/);
  assert.match(disclosure, /https:\/\/docferry\.bondie\.io\/privacy/);
});
