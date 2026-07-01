# Changelog

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
- Restore the current DocFerry dashboard/settings UI, Fuyonder account connection, upload disclosure, request-access flow, share/import tools, and free-launch access policy integration.
- Keep public billing disabled for this release; access upgrades are handled through request review rather than Checkout.
- Update public repository metadata, privacy copy, manifests, package metadata, and versions maps to the Fuyonder release line.

## 0.0.14

- Superseded by `0.0.15`. This tag used the old community plugin line and should not be used for the June 30 public free launch.
