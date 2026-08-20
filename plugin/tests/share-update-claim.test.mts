import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test("lets vault-less CLI shares be claimed for update while still rejecting other vaults", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  // The tri-state gate treats a missing vault id as claimable and only a
  // recorded mismatching id as a rejection.
  assert.match(mainSource, /resolveShareUpdateVaultGate\(share\.vault_id, vaultId\) === "wrong-vault"/);
  assert.match(mainSource, /resolveShareUpdateVaultGate\(folderShare\.vault_id, vaultId\) === "wrong-vault"/);
  assert.doesNotMatch(mainSource, /!share\.vault_id \|\| share\.vault_id !==/);
  assert.doesNotMatch(mainSource, /folderShare\.vault_id !== vaultId/);
  // The wrong-vault rejection notices must survive unchanged for both variants.
  assert.match(mainSource, /Open the source vault to update that share\./);
  assert.match(mainSource, /Open the source vault to update that folder share\./);
});

test("claims legacy absolute source paths by stripping the vault base path prefix", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  // Legacy CLI shares remember an absolute path inside the source vault; the
  // remembered path is tried as-is first, then with the prefix stripped.
  assert.match(mainSource, /vaultRelativeShareSourcePath\(share\.source_path, basePath\)/);
});

test("backfills the claiming vault id on every update payload", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /vault_id: await this\.resolveVaultId\(\)/);
});

test("still refuses to update a remembered path that belongs to a different share", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /The note at the remembered path is linked to a different share\./);
});
