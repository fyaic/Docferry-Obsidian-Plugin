import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

test("shows the v8 managed media privacy disclosure to new and upgraded installs", async () => {
  const main = await readFile(new URL("main.ts", sourceRoot), "utf8");
  const disclosure = await readFile(new URL("upload-consent-modal.ts", sourceRoot), "utf8");

  assert.match(main, /docferry-privacy-security-disclosure-v8/);
  assert.doesNotMatch(main, /docferry-privacy-security-disclosure-v7/);
  assert.match(disclosure, /only when you choose to share or save a public link/);
  assert.match(disclosure, /not end-to-end or zero-knowledge encryption/);
  assert.match(disclosure, /Saving a supported public link sends its URL/);
  assert.match(disclosure, /public YouTube URL or bounded audio or video content/);
  assert.match(disclosure, /through OpenRouter to a server-selected AI model/);
  assert.match(disclosure, /selected model provider process that input/);
  assert.match(disclosure, /does not send your Bondie identity, browser cookies, history, profile, or other vault files/);
  assert.match(disclosure, /Temporary import content is cleared/);
  assert.match(disclosure, /Before DocFerry prepares this link/);
  assert.match(disclosure, /Your account token is stored by your operating system's secure storage on this device, not in plugin data/);
  assert.match(disclosure, /https:\/\/docferry\.bondie\.io\/privacy/);
});

test("discloses the Tencent COS direct upload, temporary credentials, and API-proxy fallback", async () => {
  const disclosure = await readFile(new URL("upload-consent-modal.ts", sourceRoot), "utf8");

  assert.match(disclosure, /Tencent Cloud Object Storage \(COS\), a third-party storage provider/);
  assert.match(disclosure, /lasts about 30 minutes/);
  assert.match(disclosure, /works only for that single upload/);
  assert.match(disclosure, /never saved by the plugin/);
  assert.match(disclosure, /your note text is sent to DocFerry, not to cloud storage/);
  assert.match(disclosure, /If direct upload is unavailable or fails, the file is uploaded through the DocFerry server instead/);
  assert.match(disclosure, /unreferenced assets become eligible for deletion after 7 days/);
  assert.match(disclosure, /Stopping a share makes its content unavailable right away/);
});
