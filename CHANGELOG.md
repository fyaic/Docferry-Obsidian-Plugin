# Changelog

## 0.0.36

- Publish the paid production plugin through the Community release workflow.
- Run release tests on Node 22 so the TypeScript test modules execute in CI.

Version `0.0.35` was a pre-release candidate and did not produce a public
GitHub Release.

## 0.0.35

- Move the Community plugin to the Bondie production service and account
  boundary.
- Add the novice-first Home, My shares, Account, and Preferences workflows.
- Add paid Folder Share and bounded Full Theme support while keeping Free
  access fail-closed.
- Fix Stripe return callbacks and membership refresh behavior.
- Add public-web link import and gated detailed-note infrastructure without
  exposing model-provider credentials to the plugin.
- Protect folder assets and snapshots from maintenance cleanup and keep an
  existing folder updatable at the active-folder limit.
- Remove legacy hostnames and obsolete free-release access-request behavior.

## 0.0.21

- Add real README screenshots for the publish, reader, manage shares, settings, and import workflows.
- Add a hosted preview link for the public free release at that time.
- Rename the unpublished-note right-click action and new-share modal title to `Share thru Docferry`.
- Bump manifests, package metadata, and versions maps to `0.0.21`.

## 0.0.20

- Freeze the current public free plugin package after the July 2 release-line cleanup.
- Record hosted legal pages in the README and privacy notice.
- Bump manifests, package metadata, and versions maps to `0.0.20`.

## 0.0.18

- Replace `display: contents` in logo wrapper CSS with a transparent inline-flex wrapper to avoid the `css-display-contents` compatibility warning in Obsidian review.

## 0.0.17

- Address Obsidian Community review feedback around license, description, release assets, async click callbacks, settings render calls, CSS overrides, and privacy copy.
- Refresh the DocFerry main view, settings import panel, and share completion modal without changing publish/import/server behavior.

## 0.0.16

- Prepare the June 30 public free launch plugin for stricter Obsidian review.
- Remove non-plugin server, CLI, importer, and legacy release-note content from the public plugin repository.
- Replace raw heading elements and inline hidden-render styles with review-friendly CSS classes.
- Restore root ESLint/type-resolution metadata so automated review can resolve Obsidian types from the repository root.

## 0.0.15

- Replace the previously published legacy community build with the June 30 public free launch plugin.
- Restore the dashboard/settings UI, legacy account connection, upload disclosure, request-access flow, share/import tools, and free-launch access policy integration used at that time.
- Keep public billing disabled for this release; access upgrades are handled through request review rather than Checkout.
- Update public repository metadata, privacy copy, manifests, package metadata, and versions maps for the historical free release line.

## 0.0.14

- Superseded by `0.0.15`. This tag used the old community plugin line and should not be used for the June 30 public free launch.
