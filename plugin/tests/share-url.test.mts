import assert from "node:assert/strict";
import test from "node:test";

import { isSameDocferryOrigin, parseDocferryShareUrl } from "../src/share-url.ts";


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
