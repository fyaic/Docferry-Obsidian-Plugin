import assert from "node:assert/strict";
import test from "node:test";

import { classifyProtocolCallback } from "../src/protocol-callback.ts";


test("routes Stripe return callbacks to membership refresh instead of login", () => {
  assert.deepEqual(
    classifyProtocolCallback({ flow: "billing-return", status: "success" }),
    { kind: "billing-return", status: "success" }
  );
});

test("routes import callbacks only when a URL is present", () => {
  assert.deepEqual(
    classifyProtocolCallback({ flow: "import", url: "https://docferry.bondie.io/s/example" }),
    { kind: "import", url: "https://docferry.bondie.io/s/example" }
  );
  assert.deepEqual(
    classifyProtocolCallback({ flow: "import" }),
    { kind: "unsupported" }
  );
});

test("does not accept authentication over an Obsidian URI", () => {
  const data = { code: "dfpc_example", state: "signed-state" };
  assert.deepEqual(classifyProtocolCallback(data), { kind: "unsupported" });
});
