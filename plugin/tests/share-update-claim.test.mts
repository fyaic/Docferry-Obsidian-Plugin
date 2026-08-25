import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test("lets vault-less CLI shares be claimed for update while still rejecting other vaults", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  // The tri-state gate treats a missing vault id as claimable and only a
  // recorded mismatching id as a rejection.
  assert.match(mainSource, /resolveShareUpdateVaultGate\(share\.vault_id, vaultId, legacyVaultIds\)/);
  assert.match(mainSource, /resolveShareUpdateVaultGate\(folderShare\.vault_id, vaultId, legacyVaultIds\)/);
  assert.doesNotMatch(mainSource, /!share\.vault_id \|\| share\.vault_id !==/);
  assert.doesNotMatch(mainSource, /folderShare\.vault_id !== vaultId/);
  // The wrong-vault rejection notices must survive unchanged for both variants.
  assert.match(mainSource, /Open the source vault to update that share\./);
  assert.match(mainSource, /Open the source vault to update that folder share\./);
  assert.match(mainSource, /\(\) => confirmClaimShare\(this\.app, share\.title \|\| file\.basename, file\.path, "note"\)/);
  assert.match(mainSource, /\(\) => confirmClaimShare\(this\.app, folderShare\.title \|\| folder\.name, folder\.path, "folder"\)/);
});

test("claims only exact physical aliases or an explicitly selected relative source", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  // CLI shares may remember an absolute source path or, before vault identity
  // was added, the exact vault-relative path. Neither path may suffix-guess.
  assert.match(mainSource, /vaultRelativeShareSourcePath\(share\.source_path, basePath, process\.platform === "win32"\)/);
  assert.match(mainSource, /resolvedBasePath !== basePath/);
  assert.match(mainSource, /explicitClaimSourceMatches\(/);
  assert.match(mainSource, /This historical Share does not belong to this vault's source note\./);
});

test("lets an owner-selected relative CLI share use the explicit claim path", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(
    mainSource,
    /explicitClaimSourceMatches\([\s\S]*?share\.source_path,[\s\S]*?file\.path,[\s\S]*?sourceAliases/
  );
  assert.match(
    mainSource,
    /publishFile\(file, share, expectedVaultIdForClaim\(vaultGate, share\.vault_id\), share\.source_path\)/
  );
});

test("backfills the claiming vault id on every update payload", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /vault_id: await this\.resolveVaultId\(\)/);
  assert.match(mainSource, /"share_id" \| "vault_id" \| "source_path" \| "status"/);
  assert.match(
    mainSource,
    /resolveShareUpdateVaultGate\(existingShare\.vault_id, vaultId, legacyVaultIds\)/
  );
  assert.match(mainSource, /expectedVaultId = expectedVaultIdForClaim\(gate, existingShare\.vault_id\)/);
  assert.match(mainSource, /payload\.expected_source_path = expectedSourcePath/);
});

test("keeps the selected folder share id when claiming a vault-less folder share", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(
    mainSource,
    /\(\) => this\.publishFolder\([\s\S]*?expectedVaultIdForClaim\(vaultGate, folderShare\.vault_id\),[\s\S]*?folderShare\.source_folder[\s\S]*?\)/
  );
  assert.match(
    mainSource,
    /explicitClaimSourceMatches\([\s\S]*?folderShare\.source_folder,[\s\S]*?folder\.path,[\s\S]*?sourceAliases/
  );
  assert.match(mainSource, /const discoveredFolder = selectExistingFolderShare\(/);
  assert.match(mainSource, /folder_share_id: existingFolder\?\.folder_share_id \?\? null/);
  assert.match(mainSource, /draftPayload\.expected_vault_id = expectedVaultId/);
  assert.match(mainSource, /draftPayload\.expected_source_folder = expectedSourceFolder/);
});

test("still refuses to update a remembered path that belongs to a different share", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /The note at the remembered path is linked to a different share\./);
});

test("never claims a pre-vault share from copied frontmatter", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const branchStart = mainSource.indexOf("else if (expectedVaultId === undefined)");
  const branchEnd = mainSource.indexOf("} catch (error)", branchStart);
  const branch = mainSource.slice(branchStart, branchEnd);

  assert.ok(branchStart > -1 && branchEnd > branchStart);
  assert.match(branch, /if \(gate === "claim"\)/);
  assert.match(branch, /Open Shares and select this historical link before claiming it for this vault\./);
  assert.match(branch, /return;/);
  assert.match(branch, /if \(gate === "migrate"\)/);
});

test("same-vault copied frontmatter cannot silently retarget an existing public link", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /resolveRememberedSharePathGate\(/);
  assert.match(mainSource, /this\.sharedFilesByShareId\(existingShare\.share_id\)/);
  assert.match(mainSource, /More than one note contains this share reference\./);
  assert.match(mainSource, /confirmMovedShareUpdate\(/);
  assert.match(mainSource, /payload\.expected_source_path = expectedSourcePath/);
});
