import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLocalImageAssetPlaceholders,
  extractLocalAssetRefs,
  type SnapshotImageElement
} from "../src/local-image-refs.ts";

function fakeImage(attributes: Record<string, string>): SnapshotImageElement {
  const store = new Map(Object.entries(attributes));
  return {
    getAttribute: (name) => store.get(name) ?? null,
    setAttribute: (name, value) => void store.set(name, value)
  };
}

test("extracts wiki, markdown and raw HTML image refs in document order", () => {
  const markdown = [
    "Intro before any asset.",
    "",
    "![GitHub stars 增长](assets/github-stars-growth.png)",
    "",
    "| <img src=\"assets/bondie-kitesurf.png\" width=\"380\"> | <img src='assets/bondie-chromium.png' width='380'> |",
    "",
    "![[$vault/assets/delay-compare.png|620]]",
    "",
    "See ![cover](attachments/cover.webp) and <img src=\"assets/capability-score.png\">.",
    "",
    "[linked note](notes/related.md)"
  ].join("\n");

  assert.deepEqual(extractLocalAssetRefs(markdown), [
    { path: "assets/github-stars-growth.png", isImage: true },
    { path: "assets/bondie-kitesurf.png", isImage: true },
    { path: "assets/bondie-chromium.png", isImage: true },
    { path: "$vault/assets/delay-compare.png", isImage: true },
    { path: "attachments/cover.webp", isImage: true },
    { path: "assets/capability-score.png", isImage: true },
    { path: "notes/related.md", isImage: false }
  ]);
});

test("extraction skips remote, data and obsidian-protocol sources", () => {
  const markdown = [
    "![remote](https://example.com/chart.png)",
    "<img src=\"http://example.com/a.png\">",
    "<img src=\"data:image/png;base64,AAAA\">",
    "<img src=\"obsidian://open?vault=x\">",
    "![local](attachments/kept.png)"
  ].join("\n");

  assert.deepEqual(extractLocalAssetRefs(markdown), [
    { path: "attachments/kept.png", isImage: true }
  ]);
});

test("snapshot pairing serves raw HTML table images alongside markdown images", () => {
  // The exact production shape of the broken folder share: three markdown
  // images followed by four raw HTML images inside comparison tables.
  const images = [
    fakeImage({ src: "app://local/$vault/assets/github-stars-growth.png", alt: "GitHub stars 增长" }),
    fakeImage({ src: "app://local/$vault/assets/delay-compare.png", alt: "延迟对比" }),
    fakeImage({ src: "app://local/$vault/assets/capability-score.png", alt: "能力记分卡" }),
    fakeImage({ src: "assets/bondie-kitesurf.png", width: "380" }),
    fakeImage({ src: "assets/bondie-chromium.png", width: "380" }),
    fakeImage({ src: "assets/antibot-sannysoft-kitesurf.png", width: "380" }),
    fakeImage({ src: "assets/antibot-sannysoft-chromium.png", width: "380" })
  ];
  const imageAssets = [
    { assetId: "asset_stars", originalPath: "assets/github-stars-growth.png" },
    { assetId: "asset_delay", originalPath: "assets/delay-compare.png" },
    { assetId: "asset_score", originalPath: "assets/capability-score.png" },
    { assetId: "asset_kitesurf", originalPath: "assets/bondie-kitesurf.png" },
    { assetId: "asset_chromium", originalPath: "assets/bondie-chromium.png" },
    { assetId: "asset_sanny_kitesurf", originalPath: "assets/antibot-sannysoft-kitesurf.png" },
    { assetId: "asset_sanny_chromium", originalPath: "assets/antibot-sannysoft-chromium.png" }
  ];

  applyLocalImageAssetPlaceholders(images, imageAssets);

  const srcs = images.map((image) => image.getAttribute("src"));
  assert.deepEqual(srcs, [
    "docferry-asset://asset_stars",
    "docferry-asset://asset_delay",
    "docferry-asset://asset_score",
    "docferry-asset://asset_kitesurf",
    "docferry-asset://asset_chromium",
    "docferry-asset://asset_sanny_kitesurf",
    "docferry-asset://asset_sanny_chromium"
  ]);
  assert.equal(images[3].getAttribute("loading"), "lazy");
  assert.equal(images[3].getAttribute("decoding"), "async");
});

test("snapshot pairing repairs positional drift through path matching", () => {
  // An unresolvable embed renders no <img>, but a raw markdown image to a
  // missing file does render one and consumes an asset slot, shifting the
  // positional sequence. The path-matching repair pass must restore the
  // correct asset for every image it can identify by src.
  const images = [
    fakeImage({ src: "attachments/missing.png", alt: "broken" }),
    fakeImage({ src: "app://local/$vault/assets/delay-compare.png?1724500000", alt: "延迟对比" }),
    fakeImage({ src: "assets/capability-score.png", alt: "能力记分卡" })
  ];
  const imageAssets = [
    { assetId: "asset_delay", originalPath: "assets/delay-compare.png" },
    { assetId: "asset_score", originalPath: "assets/capability-score.png" }
  ];

  applyLocalImageAssetPlaceholders(images, imageAssets);

  assert.equal(images[0].getAttribute("src"), "attachments/missing.png");
  assert.equal(images[1].getAttribute("src"), "docferry-asset://asset_delay");
  assert.equal(images[2].getAttribute("src"), "docferry-asset://asset_score");
});

test("snapshot pairing leaves remote and data images untouched", () => {
  const images = [
    fakeImage({ src: "https://example.com/remote.png" }),
    fakeImage({ src: "data:image/gif;base64,R0lGOD" })
  ];
  const imageAssets = [{ assetId: "asset_local", originalPath: "attachments/kept.png" }];

  applyLocalImageAssetPlaceholders(images, imageAssets);

  assert.equal(images[0].getAttribute("src"), "https://example.com/remote.png");
  assert.equal(images[1].getAttribute("src"), "data:image/gif;base64,R0lGOD");
});

test("positional pairing only serves empty-src elements and never misassigns", () => {
  const images = [
    fakeImage({ src: "" }),
    fakeImage({ src: "blob:opaque" }),
    fakeImage({ src: "" })
  ];
  const imageAssets = [
    { assetId: "asset_a", originalPath: "attachments/a.png" },
    null,
    { assetId: "asset_c", originalPath: "attachments/c.png" }
  ];

  applyLocalImageAssetPlaceholders(images, imageAssets);

  // The empty-src element consumes the first slot (an asset, assigned); the
  // blob src cannot be identified, so it stays unserved instead of borrowing
  // another reference's asset; the second empty-src element consumes the
  // null slot (a reference with no upload) and stays unserved too.
  assert.equal(images[0].getAttribute("src"), "docferry-asset://asset_a");
  assert.equal(images[1].getAttribute("src"), "blob:opaque");
  assert.equal(images[2].getAttribute("src"), "");
});

test("an unresolvable reference never receives another image's asset", () => {
  // Production-shaped drift: an embed whose file is missing keeps its local
  // src and must not steal the asset of a reference that only exists inside
  // a code block (uploaded by an older extractor, orphaned here).
  const images = [
    fakeImage({ src: "app://local/$vault/attachments/a.png", alt: "a" }),
    fakeImage({ src: "attachments/missing.png", alt: "missing" })
  ];
  const imageAssets = [
    { assetId: "asset_a", originalPath: "attachments/a.png" },
    { assetId: "asset_codeblock", originalPath: "attachments/codeblock.png" }
  ];

  applyLocalImageAssetPlaceholders(images, imageAssets);

  assert.equal(images[0].getAttribute("src"), "docferry-asset://asset_a");
  assert.equal(images[1].getAttribute("src"), "attachments/missing.png");
});

test("extracts wiki attachment links, anchor hrefs and media sources", () => {
  const markdown = [
    "See [[report.pdf]] and <a href=\"assets/manual.pdf\">the manual</a>.",
    "<video src=\"clips/demo.mp4\" controls width=\"480\"></video>",
    "<audio src='audio/voice-memo.mp3' controls></audio>",
    "<video controls><source src=\"clips/demo.webm\" type=\"video/webm\"></video>",
    "<iframe src=\"assets/paper.pdf\"></iframe>",
    "<a href=\"#section\">jump</a> · <a href=\"mailto:x@y.z\">mail</a> · <a href=\"https://example.com/a.pdf\">remote</a>",
    "![kept.png](attachments/kept.png)"
  ].join("\n");

  assert.deepEqual(extractLocalAssetRefs(markdown), [
    { path: "report.pdf", isImage: false },
    { path: "assets/manual.pdf", isImage: false },
    { path: "clips/demo.mp4", isImage: true },
    { path: "audio/voice-memo.mp3", isImage: true },
    { path: "clips/demo.webm", isImage: true },
    { path: "attachments/kept.png", isImage: true }
  ]);
});

test("references inside code fences, inline code and comments are not extracted", () => {
  const markdown = [
    "![visible.png](attachments/visible.png)",
    "",
    "```md",
    "![example.png](attachments/example.png)",
    "<img src=\"assets/secret.png\">",
    "```",
    "",
    "Inline `![[draft.png]]` stays local, and <!-- ![[commented.png]] --> too.",
    "A real <a href=\"assets/live.pdf\">manual</a> plus a masked <!-- <a href=\"assets/old.pdf\">draft</a> --> copy."
  ].join("\n");

  assert.deepEqual(extractLocalAssetRefs(markdown), [
    { path: "attachments/visible.png", isImage: true },
    { path: "assets/live.pdf", isImage: false }
  ]);
});

test("pairing matches ./-prefixed reference paths against rendered sources", () => {
  const images = [
    fakeImage({ src: "app://local/$vault/pic.png", alt: "pic" })
  ];
  const imageAssets = [
    { assetId: "asset_pic", originalPath: "./pic.png" }
  ];

  applyLocalImageAssetPlaceholders(images, imageAssets);

  assert.equal(images[0].getAttribute("src"), "docferry-asset://asset_pic");
});

test("snapshot pairing rewrites video, audio and source elements by path", () => {
  const media = [
    fakeImage({ src: "app://local/$vault/clips/demo.mp4" }),
    fakeImage({ src: "audio/voice-memo.mp3" }),
    fakeImage({ src: "clips/demo.webm" })
  ];
  const imageAssets = [
    { assetId: "asset_demo", originalPath: "clips/demo.mp4" },
    { assetId: "asset_memo", originalPath: "audio/voice-memo.mp3" },
    { assetId: "asset_webm", originalPath: "clips/demo.webm" }
  ];

  applyLocalImageAssetPlaceholders(media, imageAssets);

  assert.equal(media[0].getAttribute("src"), "docferry-asset://asset_demo");
  assert.equal(media[1].getAttribute("src"), "docferry-asset://asset_memo");
  assert.equal(media[2].getAttribute("src"), "docferry-asset://asset_webm");
});

test("snapshot pairing does nothing without uploaded image assets", () => {
  const images = [fakeImage({ src: "attachments/kept.png" })];
  applyLocalImageAssetPlaceholders(images, []);
  assert.equal(images[0].getAttribute("src"), "attachments/kept.png");
});
