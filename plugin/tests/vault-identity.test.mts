import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildVaultIdentity, buildVaultSourceAliases, canonicalVaultPath } from "../src/vault-identity.ts";

const hash = async (value: string): Promise<string> => createHash("sha256").update(value).digest("hex");

test("canonicalizes host path separators and Windows casing", () => {
  assert.equal(canonicalVaultPath("C:\\Users\\Owner\\Vault\\", "win32"), "c:/users/owner/vault");
  assert.equal(canonicalVaultPath("/private/tmp/Vault/", "darwin"), "/private/tmp/Vault");
});

test("uses the resolved path while retaining pre-canonical plugin and Agent Kit aliases", async () => {
  const identity = await buildVaultIdentity("/tmp/Vault", "/private/tmp/Vault", "Vault", hash, "darwin");
  const canonical = `vlt_${(await hash("Vault|/private/tmp/Vault")).slice(0, 24)}`;
  const oldPlugin = `vlt_${(await hash("Vault|/tmp/Vault")).slice(0, 24)}`;
  const oldAgent = `workspace_${(await hash("/private/tmp/Vault")).slice(0, 24)}`;
  assert.equal(identity.vaultId, canonical);
  assert.ok(identity.legacyVaultIds.includes(oldPlugin));
  assert.ok(identity.legacyVaultIds.includes(oldAgent));
});

test("builds exact raw and physical aliases for a vault source", () => {
  assert.deepEqual(
    buildVaultSourceAliases(
      "/tmp/Vault",
      "/private/tmp/Vault",
      "Notes/a.md",
      "/private/tmp/Vault/Notes/a.md"
    ),
    ["/tmp/Vault/Notes/a.md", "/private/tmp/Vault/Notes/a.md"]
  );
});

test("does not build aliases for a source that escapes the vault", () => {
  assert.deepEqual(
    buildVaultSourceAliases("/tmp/Vault", "/private/tmp/Vault", "../Other/a.md"),
    []
  );
  assert.deepEqual(
    buildVaultSourceAliases(
      "/tmp/Vault",
      "/private/tmp/Vault",
      "Notes/a.md",
      "/private/tmp/Other/a.md"
    ),
    ["/tmp/Vault/Notes/a.md", "/private/tmp/Vault/Notes/a.md"]
  );
});
