import assert from "node:assert/strict";
import test from "node:test";

import {
  hasActiveShareLink,
  resolveShareUpdateVaultGate,
  shareListSummary,
  vaultRelativeShareSourcePath,
} from "../src/share-actions.ts";

test("keeps actions only for share links that can still be opened", () => {
  assert.equal(hasActiveShareLink("published"), true);
  assert.equal(hasActiveShareLink("password_protected"), true);
  assert.equal(hasActiveShareLink("expired"), false);
  assert.equal(hasActiveShareLink("stopped"), false);
});

test("summarizes live and past shares without treating history as active", () => {
  assert.equal(shareListSummary([]), "No shares yet.");
  assert.equal(shareListSummary(["published", "password_protected"]), "2 live shares.");
  assert.equal(shareListSummary(["stopped", "expired"]), "2 past shares.");
  assert.equal(shareListSummary(["published", "stopped"]), "1 live share, 1 past share.");
});

test("allows claiming a share whose vault id is null, undefined, or empty", () => {
  assert.equal(resolveShareUpdateVaultGate(null, "vlt_local"), "claim");
  assert.equal(resolveShareUpdateVaultGate(undefined, "vlt_local"), "claim");
  assert.equal(resolveShareUpdateVaultGate("", "vlt_local"), "claim");
});

test("updates a share whose vault id matches the local vault", () => {
  assert.equal(resolveShareUpdateVaultGate("vlt_local", "vlt_local"), "update");
});

test("rejects a share whose vault id belongs to a different vault", () => {
  assert.equal(resolveShareUpdateVaultGate("vlt_other", "vlt_local"), "wrong-vault");
});

test("strips the vault base path prefix from legacy absolute source paths", () => {
  assert.equal(
    vaultRelativeShareSourcePath("/Users/owner/Vault/meetings/notes.md", "/Users/owner/Vault"),
    "meetings/notes.md"
  );
});

test("keeps absolute source paths outside the vault untouched", () => {
  assert.equal(
    vaultRelativeShareSourcePath("/Users/owner/OtherVault/meetings/notes.md", "/Users/owner/Vault"),
    "/Users/owner/OtherVault/meetings/notes.md"
  );
  // A sibling directory that merely shares the prefix must not be stripped either.
  assert.equal(
    vaultRelativeShareSourcePath("/Users/owner/VaultNotes/notes.md", "/Users/owner/Vault"),
    "/Users/owner/VaultNotes/notes.md"
  );
});

test("keeps vault-relative source paths and the base path itself untouched", () => {
  assert.equal(vaultRelativeShareSourcePath("meetings/notes.md", "/Users/owner/Vault"), "meetings/notes.md");
  assert.equal(vaultRelativeShareSourcePath("/Users/owner/Vault", "/Users/owner/Vault"), "/Users/owner/Vault");
});
