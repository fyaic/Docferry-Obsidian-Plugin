# Changelog

## 0.0.11

- Enable full TypeScript `strict` mode (plus `skipLibCheck`, `esModuleInterop`, and `forceConsistentCasingInFileNames`) so the project type-checks under the strictest settings; `tsc -noEmit` and ESLint both pass with zero problems.
- Respond to the automated review round on 0.0.10: the `@typescript-eslint/no-unsafe-*` warnings are resolved-as-`any` false positives that appear when the reviewer's type-aware lint cannot resolve the Obsidian type declarations; the source already lints clean against the bundled `typescript-eslint` and `eslint-plugin-obsidianmd` rules.
- Confirm clipboard access remains write-only and triggered only by explicit user actions (already documented in `PRIVACY.md`).

## 0.0.10

- Restore the default DocFerry Cloud endpoint to `https://docferry.fuyonder.tech` while the Bondie subdomain DNS/TLS rollout remains unresolved.
- Keep the plugin release version aligned across root manifest, plugin manifest, npm package metadata, lockfile, `versions.json`, CHANGELOG, and release notes.

## 0.0.9

- Remove disallowed `eslint-disable-next-line obsidianmd/ui/sentence-case` comments.
- Rephrase the server URL and manual cloud token placeholders to follow Obsidian sentence-case guidelines.
- Add local ESLint setup with `eslint-plugin-obsidianmd` to catch sentence-case and other review rules before submission.

## 0.0.8

- Replace `window.confirm` with an Obsidian `Modal`-based confirmation dialog.
- Use `activeDocument` instead of `document` for hidden preview rendering and theme CSS capture.
- Tighten TypeScript catch-variable typing with `useUnknownInCatchVariables`; remove unused `_error` bindings.
- Add `as unknown` casts around `JSON.parse` for strict ESLint rules.
- Remove redundant type assertions (`as string`, `as HTMLElement`).
- Use a dedicated short-lived `Component` for `MarkdownRenderer.render` instead of the plugin instance.
- Bind translator callbacks passed to `ConfirmModal` to avoid unbound-method warnings.
- Remove unnecessary `async` from event handlers and keep `Setting` callbacks in block bodies.
- Raise `minAppVersion` to `1.13.0` to match the `Plugin.settings` and deprecated `SettingTab` APIs used in the settings UI.
- Keep GitHub release notes and artifact attestations for release assets.

## 0.0.7

- Add GitHub release notes and artifact attestations for release assets.
- Address Obsidian automated review errors for static style assignment and settings headings.
- Avoid vault-wide enumeration in share management by using the account share list and direct source-path lookup.
- Tighten TypeScript error handling around API errors and caught exceptions.

## 0.0.6

- Standardize the free and open-source Obsidian plugin identity as DocFerry by Bondie Labs.
- Rename the public plugin ID to `docferry`.
- Remove public SSO and team-login entry points from the free plugin branch.
- Route asset uploads through the configured DocFerry server instead of a vendor object-storage SDK in the plugin.
- Add DocFerry logo assets and the official project website link.
- Add root release files for Obsidian Community preparation.
- Add DocFerry Cloud service mode with anonymous in-plugin token claim.
- Add free Cloud quota copy for 5 active shares, with stopped and expired shares excluded from the active count.
- Add a plugin settings share management area for account-level DocFerry shares, with local vault records merged when available.
- Add Cloud account status support through `GET /v0/account`.
- Add server-side encrypted-at-rest storage for note body fields and object bytes.
- Update privacy copy for encrypted-at-rest storage and Docferry Cloud server rendering boundaries.
