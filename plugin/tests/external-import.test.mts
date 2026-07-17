import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExternalLinkNote,
  externalLinkProvider,
  validatedExternalImportUrl
} from "../src/external-import.ts";

test("classifies supported media providers without trusting lookalike domains", () => {
  const cases = [
    ["https://youtu.be/abc", "youtube"],
    ["https://music.youtube.com/watch?v=abc", "youtube"],
    ["https://www.tiktok.com/@bondie/video/1", "tiktok"],
    ["https://b23.tv/abc", "bilibili"],
    ["https://www.bilibili.com/video/BV1", "bilibili"],
    ["https://www.douyin.com/video/1", "douyin"],
    ["https://mp.weixin.qq.com/s/article", "wechat"],
    ["https://vimeo.com/123", "vimeo"],
    ["https://cdn.example.test/audio.MP3", "audio"],
    ["https://cdn.example.test/video.webm?download=1", "video"],
    ["https://notyoutube.com/watch?v=abc", "web"],
    ["https://evilbilibili.com/video/1", "web"],
    ["https://mp.weixin.qq.com.evil.example/s/article", "web"]
  ] as const;

  for (const [value, expected] of cases) {
    assert.equal(externalLinkProvider(new URL(value)), expected, value);
  }
});

test("builds a deterministic link-only note without fetching remote content", () => {
  const result = buildExternalLinkNote("https://www.youtube.com/watch?v=launch-01", "2026-07-14T00:00:00.000Z");

  assert.equal(result.provider, "youtube");
  assert.equal(result.title, "YouTube - launch-01");
  assert.match(result.markdown, /type: link/);
  assert.match(result.markdown, /parse_status: link_only/);
  assert.match(result.markdown, /imported_at: "2026-07-14T00:00:00.000Z"/);
  assert.match(result.markdown, /\[Open original link\]\(<https:\/\/www\.youtube\.com\/watch\?v=launch-01>\)/);
});

test("rejects unsafe schemes, malformed URLs, and embedded credentials", () => {
  for (const value of [
    "javascript:alert(1)",
    "file:///tmp/private.md",
    "https://user:password@example.com/private",
    "not a url"
  ]) {
    assert.throws(() => validatedExternalImportUrl(value), /valid web URL|Only public http or https/);
  }
});

test("removes heading control characters from URL-derived titles", () => {
  const result = buildExternalLinkNote("https://youtu.be/line%0Abreak");
  assert.equal(result.title, "YouTube - line-break");
  assert.doesNotMatch(result.title, /[\r\n]/);
});
