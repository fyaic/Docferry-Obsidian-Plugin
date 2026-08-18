import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test("uses the consumer browser completion flow for Obsidian login", async () => {
  const authSource = await readFile(new URL("../src/auth-service.ts", import.meta.url), "utf8");
  const apiSource = await readFile(new URL("../src/api-client.ts", import.meta.url), "utf8");
  const startLoginSource = authSource;

  assert.match(authSource, /withLoginContext/);
  assert.match(authSource, /client_state/);
  assert.match(authSource, /exchangePendingAuth/);
  assert.match(authSource, /confirm the account, then return to Obsidian/);
  assert.match(startLoginSource, /openExternalUrl\(withLoginContext/);
  assert.doesNotMatch(startLoginSource, /obsidian:\/\//);
  assert.doesNotMatch(authSource, /handleProtocolCallback/);
  assert.doesNotMatch(startLoginSource, /createDeviceAuthorization/);
  assert.doesNotMatch(startLoginSource, /verification_uri_complete/);
  assert.match(apiSource, /\/v0\/auth\/exchange\/pending/);
});


test("obsidian browser polling is bound to a persisted PKCE verifier", async () => {
  const authSource = await readFile(new URL("../src/auth-service.ts", import.meta.url), "utf8");
  const apiSource = await readFile(new URL("../src/api-client.ts", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(authSource, /createCodeVerifier/);
  assert.match(authSource, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(authSource, /url\.searchParams\.set\("code_challenge", codeChallenge\)/);
  assert.match(authSource, /url\.searchParams\.set\("code_challenge_method", "S256"\)/);
  assert.match(authSource, /savePendingLogin\(clientState, new Date\(\)\.toISOString\(\), codeVerifier\)/);
  assert.match(authSource, /exchangePendingAuth\(clientState, codeVerifier\)/);
  assert.match(authSource, /pollPendingLogin\(pending\.state, pending\.verifier, attempt\)/);
  assert.match(authSource, /!pending\.verifier/);
  assert.match(apiSource, /code_verifier: codeVerifier/);
  // The PKCE verifier must never persist to data.json: custody lives in
  // SecretStorage and the settings schema carries no pendingAuth* fields.
  assert.doesNotMatch(settingsSource, /pendingAuthState|pendingAuthStartedAt|pendingAuthVerifier/);
  assert.match(mainSource, /persistPendingLogin\(this\.app\.secretStorage, \{ state, startedAt, verifier \}\)/);
  assert.match(mainSource, /\(\) => readPendingLogin\(this\.app\.secretStorage\)/);
});


test("consumer login polling is private and bounded without an Obsidian auth callback", async () => {
  const source = await readFile(new URL("../src/auth-service.ts", import.meta.url), "utf8");

  assert.match(source, /!\("access_token" in result\)/);
  assert.match(source, /crypto\.getRandomValues/);
  assert.match(source, /loginAttempt/);
  assert.match(source, /Date\.now\(\) < deadline/);
  assert.doesNotMatch(source, /user_code/);
});
