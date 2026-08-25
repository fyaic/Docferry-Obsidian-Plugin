import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isCurrentRequest } from "../src/request-freshness.ts";

test("only the latest request for the current account may update the share list", () => {
  assert.equal(isCurrentRequest(4, 4, "account-b", "account-b"), true);
  assert.equal(isCurrentRequest(3, 4, "account-a", "account-b"), false);
  assert.equal(isCurrentRequest(4, 4, "account-a", "account-b"), false);
});

test("the dashboard guards both successful and failed share responses", async () => {
  const source = await readFile(new URL("../src/dashboard-view.ts", import.meta.url), "utf8");
  assert.match(source, /const requestGeneration = \+\+this\.sharesRequestGeneration/);
  assert.equal(source.match(/isCurrentRequest\(requestGeneration/g)?.length, 3);
  assert.match(source, /this\.sharesRequestGeneration \+= 1/);
});

test("a delayed account A success cannot overwrite account B", async () => {
  let generation = 0;
  let currentKey = "account-a";
  let visible = "";
  let releaseA: (value: string) => void = () => undefined;
  const responseA = new Promise<string>((resolve) => { releaseA = resolve; });

  const load = async (key: string, response: Promise<string>): Promise<void> => {
    currentKey = key;
    const requestGeneration = ++generation;
    const value = await response;
    if (isCurrentRequest(requestGeneration, generation, key, currentKey)) visible = value;
  };

  const pendingA = load("account-a", responseA);
  await load("account-b", Promise.resolve("shares-b"));
  releaseA("shares-a");
  await pendingA;
  assert.equal(visible, "shares-b");
});

test("a delayed account A failure cannot clear account B", async () => {
  let generation = 0;
  let currentKey = "account-a";
  let visible = "";
  let releaseA: () => void = () => undefined;
  const responseA = new Promise<string>((_resolve, reject) => {
    releaseA = () => reject(new Error("account A failed"));
  });

  const load = async (key: string, response: Promise<string>): Promise<void> => {
    currentKey = key;
    const requestGeneration = ++generation;
    try {
      const value = await response;
      if (isCurrentRequest(requestGeneration, generation, key, currentKey)) visible = value;
    } catch {
      if (isCurrentRequest(requestGeneration, generation, key, currentKey)) visible = "error";
    }
  };

  const pendingA = load("account-a", responseA);
  await load("account-b", Promise.resolve("shares-b"));
  releaseA();
  await pendingA;
  assert.equal(visible, "shares-b");
});
