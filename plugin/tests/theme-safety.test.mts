import assert from "node:assert/strict";
import test from "node:test";

import { isRemoteUrl, sanitizeCssRule, sanitizeSelectorForMatch } from "../src/theme-safety.ts";

test("removes transient pseudo states before matching theme selectors", () => {
  assert.equal(sanitizeSelectorForMatch(".markdown-preview-view a:hover::after"), ".markdown-preview-view a");
  assert.equal(sanitizeSelectorForMatch("::before"), null);
});

test("drops CSS rules that can load or execute remote content", () => {
  assert.equal(sanitizeCssRule(".note { color: #111; }"), ".note { color: #111; }");
  assert.equal(sanitizeCssRule(".note { background: url(https://example.com/a.png); }"), null);
  assert.equal(sanitizeCssRule("@import 'https://example.com/theme.css';"), null);
  assert.equal(sanitizeCssRule(".note { width: expression(alert(1)); }"), null);
});

test("recognizes remote and in-memory asset URLs", () => {
  assert.equal(isRemoteUrl("https://example.com/a.png"), true);
  assert.equal(isRemoteUrl("//cdn.example.com/a.png"), true);
  assert.equal(isRemoteUrl("data:image/png;base64,abc"), true);
  assert.equal(isRemoteUrl("blob:https://example.com/id"), true);
  assert.equal(isRemoteUrl("attachments/a.png"), false);
});
