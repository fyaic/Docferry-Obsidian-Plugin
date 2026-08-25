import assert from "node:assert/strict";
import test from "node:test";

import {
  hasActiveShareLink,
  continueShareUpdate,
  explicitClaimSourceMatches,
  expectedVaultIdForClaim,
  resolveRememberedSharePathGate,
  resolveShareUpdateVaultGate,
  selectExistingNoteShare,
  selectExistingFolderShare,
  sourcePathMatchesAliases,
  shareListSummary,
  vaultRelativeShareSourcePath,
} from "../src/share-actions.ts";

test("copied frontmatter cannot retarget a same-vault public link", () => {
  assert.equal(
    resolveRememberedSharePathGate(
      "Notes/original.md",
      "Notes/copy.md",
      ["Notes/original.md", "Notes/copy.md"]
    ),
    "ambiguous"
  );
  assert.equal(
    resolveRememberedSharePathGate(
      "Notes/original.md",
      "Notes/original.md",
      ["Notes/original.md", "Notes/copy.md"]
    ),
    "ambiguous"
  );
  assert.equal(
    resolveRememberedSharePathGate("Notes/original.md", "Archive/original.md", ["Archive/original.md"]),
    "move"
  );
  assert.equal(
    resolveRememberedSharePathGate("Notes/original.md", "Notes/original.md", ["Notes/original.md"]),
    "update"
  );
});

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

test("migrates a share whose vault id matches a deterministic legacy alias", () => {
  assert.equal(
    resolveShareUpdateVaultGate("workspace_legacy", "vlt_local", ["workspace_legacy"]),
    "migrate"
  );
});

test("claim and migration carry the exact observed vault value for compare-and-set", () => {
  assert.equal(expectedVaultIdForClaim("claim", null), null);
  assert.equal(expectedVaultIdForClaim("migrate", "workspace_legacy"), "workspace_legacy");
  assert.equal(expectedVaultIdForClaim("update", "vlt_local"), undefined);
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

test("strips Windows vault prefixes and returns an Obsidian-relative path", () => {
  assert.equal(
    vaultRelativeShareSourcePath("C:\\Users\\owner\\Vault\\meetings\\notes.md", "C:\\Users\\owner\\Vault\\"),
    "meetings/notes.md"
  );
});

test("compares Windows paths case-insensitively without changing source casing", () => {
  assert.equal(
    vaultRelativeShareSourcePath(
      "C:\\Users\\Owner\\Vault\\Meetings\\Notes.md",
      "c:\\users\\owner\\vault",
      true
    ),
    "Meetings/Notes.md"
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

test("a selected vault-less folder share remains the update target", () => {
  const selected = { vault_id: null, source_folder: "Projects", status: "published" as const, id: "legacy" };
  const discovered = { vault_id: "vlt_local", source_folder: "Projects", status: "published" as const, id: "other" };
  assert.equal(
    selectExistingFolderShare(selected, [discovered], "Projects", new Set(["vlt_local"])),
    selected
  );
});

test("folder discovery accepts canonical and deterministic legacy vault ids", () => {
  const legacy = {
    vault_id: "workspace_legacy",
    source_folder: "Projects",
    status: "published" as const,
    id: "legacy"
  };
  assert.equal(
    selectExistingFolderShare(undefined, [legacy], "Projects", new Set(["vlt_local", "workspace_legacy"])),
    legacy
  );
});

test("folder discovery claims a vault-less share only through an exact absolute alias", () => {
  const exact = {
    vault_id: null,
    source_folder: "/private/tmp/Vault/Projects",
    status: "published" as const,
    id: "exact"
  };
  const sameSuffix = {
    ...exact,
    source_folder: "/private/tmp/Other/Projects",
    id: "other"
  };
  assert.equal(
    selectExistingFolderShare(
      undefined,
      [sameSuffix, exact],
      "Projects",
      new Set(["vlt_local"]),
      false,
      ["/tmp/Vault/Projects", "/private/tmp/Vault/Projects"]
    ),
    exact
  );
  assert.equal(
    selectExistingFolderShare(undefined, [exact], "Projects", new Set(["vlt_local"])),
    undefined
  );
});

test("source alias matching never falls back to a shared suffix", () => {
  const aliases = ["/tmp/Vault/Notes/a.md", "/private/tmp/Vault/Notes/a.md"];
  assert.equal(sourcePathMatchesAliases("/private/tmp/Vault/Notes/a.md", aliases), true);
  assert.equal(sourcePathMatchesAliases("/private/tmp/Other/Notes/a.md", aliases), false);
});

test("an explicitly selected pre-vault share may claim the exact vault-relative source", () => {
  const aliases = [
    "/tmp/Vault/Notes/rosetta.md",
    "/private/tmp/Vault/Notes/rosetta.md"
  ];
  assert.equal(
    explicitClaimSourceMatches("Notes/rosetta.md", "Notes/rosetta.md", aliases),
    true
  );
  assert.equal(
    explicitClaimSourceMatches("Other/rosetta.md", "Notes/rosetta.md", aliases),
    false
  );
  assert.equal(
    explicitClaimSourceMatches("/private/tmp/Other/Notes/rosetta.md", "Notes/rosetta.md", aliases),
    false
  );
});

test("explicit relative claims follow Windows casing only on Windows", () => {
  assert.equal(explicitClaimSourceMatches("notes/ROSETTA.md", "Notes/rosetta.md", [], true), true);
  assert.equal(explicitClaimSourceMatches("notes/ROSETTA.md", "Notes/rosetta.md", [], false), false);
});

test("ordinary note discovery finds one vault-less CLI share and refuses ambiguity", () => {
  const first = { vault_id: null, source_path: "/Vault/Notes/a.md", status: "published" as const, id: "one" };
  const second = { ...first, id: "two" };
  const sourcePathInVault = () => "Notes/a.md";
  assert.equal(
    selectExistingNoteShare([first], "Notes/a.md", new Set(["vlt_local"]), sourcePathInVault),
    first
  );
  assert.equal(
    selectExistingNoteShare([first, second], "Notes/a.md", new Set(["vlt_local"]), sourcePathInVault),
    null
  );
});

test("note discovery normalizes Unicode and follows Windows case semantics only when requested", () => {
  const item = {
    vault_id: "vlt_local",
    source_path: "Notes/Cafe\u0301.md",
    status: "published" as const,
    id: "unicode"
  };
  assert.equal(
    selectExistingNoteShare(
      [item],
      "notes/CAFÉ.md",
      new Set(["vlt_local"]),
      (candidate) => candidate.source_path,
      true
    ),
    item
  );
  assert.equal(
    selectExistingNoteShare(
      [item],
      "notes/CAFÉ.md",
      new Set(["vlt_local"]),
      (candidate) => candidate.source_path,
      false
    ),
    undefined
  );
});

test("folder discovery follows Windows case semantics only when requested", () => {
  const item = {
    vault_id: "vlt_local",
    source_folder: "Projects/Launch",
    status: "published" as const,
    id: "folder"
  };
  assert.equal(
    selectExistingFolderShare(undefined, [item], "projects/launch", new Set(["vlt_local"]), true),
    item
  );
  assert.equal(
    selectExistingFolderShare(undefined, [item], "projects/launch", new Set(["vlt_local"]), false),
    undefined
  );
});

test("a cancelled vault-less claim performs no update request", async () => {
  let updates = 0;
  const continued = await continueShareUpdate(
    "claim",
    async () => false,
    async () => { updates += 1; }
  );
  assert.equal(continued, false);
  assert.equal(updates, 0);
});

test("a confirmed claim and a known-vault update each perform exactly one update", async () => {
  let updates = 0;
  assert.equal(await continueShareUpdate("claim", async () => true, async () => { updates += 1; }), true);
  assert.equal(await continueShareUpdate("update", async () => false, async () => { updates += 1; }), true);
  assert.equal(updates, 2);
});
