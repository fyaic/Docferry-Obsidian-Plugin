import assert from "node:assert/strict";
import test from "node:test";

import { isSameDocferryOrigin, legacyFrontmatterFields, legacyShareMetaForService, parseDocferryShareUrl } from "../src/share-url.ts";


const SERVICE_URL = "https://docferry.bondie.io";


test("accepts only canonical shares from the configured DocFerry origin", () => {
  assert.deepEqual(parseDocferryShareUrl("https://docferry.bondie.io/s/abc123", SERVICE_URL), {
    baseUrl: SERVICE_URL,
    slug: "abc123"
  });
  assert.deepEqual(parseDocferryShareUrl("https://docferry.bondie.io/s/abc123?from=plugin", SERVICE_URL), {
    baseUrl: SERVICE_URL,
    slug: "abc123"
  });
});

test("rejects lookalike hosts, credentials, extra paths, and unsafe schemes", () => {
  assert.equal(parseDocferryShareUrl("https://docferry.bondie.io.evil.test/s/abc123", SERVICE_URL), null);
  assert.equal(parseDocferryShareUrl("https://user:pass@docferry.bondie.io/s/abc123", SERVICE_URL), null);
  assert.equal(parseDocferryShareUrl("https://docferry.bondie.io/s/abc123/assets/file", SERVICE_URL), null);
  assert.equal(parseDocferryShareUrl("file:///s/abc123", SERVICE_URL), null);
});

test("allows import assets only from the configured DocFerry origin", () => {
  assert.equal(isSameDocferryOrigin("https://docferry.bondie.io/s/abc123/assets/image", SERVICE_URL), true);
  assert.equal(isSameDocferryOrigin("https://assets.example.test/image", SERVICE_URL), false);
  assert.equal(isSameDocferryOrigin("https://user:pass@docferry.bondie.io/image", SERVICE_URL), false);
});

const LEGACY_URL = "https://docferry.fuyonder.tech/s/legacy123";

test("detects legacy share references from a different service origin", () => {
  assert.deepEqual(
    legacyShareMetaForService({ id: "df_legacy", url: LEGACY_URL }, SERVICE_URL),
    { id: "df_legacy", url: LEGACY_URL }
  );
});

test("detects malformed share references as legacy so they are preserved", () => {
  assert.deepEqual(
    legacyShareMetaForService({ id: "df_broken", url: "not a url" }, SERVICE_URL),
    { id: "df_broken", url: "not a url" }
  );
});

test("ignores current-service references and incomplete meta", () => {
  assert.equal(
    legacyShareMetaForService({ id: "df_current", url: "https://docferry.bondie.io/s/abc123" }, SERVICE_URL),
    null
  );
  assert.equal(legacyShareMetaForService({ id: "df_only" }, SERVICE_URL), null);
  assert.equal(legacyShareMetaForService({ url: LEGACY_URL }, SERVICE_URL), null);
  assert.equal(legacyShareMetaForService({}, SERVICE_URL), null);
});

test("maps legacy references to df_legacy fields when absent", () => {
  assert.deepEqual(legacyFrontmatterFields({}, { id: "df_legacy", url: LEGACY_URL }), {
    df_legacy_id: "df_legacy",
    df_legacy_url: LEGACY_URL
  });
});

test("never overwrites an already-preserved legacy reference", () => {
  assert.deepEqual(
    legacyFrontmatterFields(
      { df_legacy_id: "df_first", df_legacy_url: "https://docferry.fuyonder.tech/s/first" },
      { id: "df_second", url: "https://docferry.fuyonder.tech/s/second" }
    ),
    {}
  );
  assert.deepEqual(
    legacyFrontmatterFields({ df_legacy_url: "https://docferry.fuyonder.tech/s/first" }, { id: "df_second", url: LEGACY_URL }),
    { df_legacy_id: "df_second" }
  );
});

test("treats empty preserved fields as absent", () => {
  assert.deepEqual(
    legacyFrontmatterFields({ df_legacy_id: "", df_legacy_url: "" }, { id: "df_legacy", url: LEGACY_URL }),
    { df_legacy_id: "df_legacy", df_legacy_url: LEGACY_URL }
  );
});
