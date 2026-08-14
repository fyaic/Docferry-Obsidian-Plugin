# Changelog

## 0.0.66

- Replace the retired free-service client with the complete Bondie-powered
  DocFerry product while preserving the Community plugin ID `docferry`.
- Add system-browser Bondie sign-in, the DocFerry Dashboard, membership and
  billing entry points, and explicit Free/Pro usage presentation.
- Unify DocFerry Share, ordinary web link, article, video, and audio saving in
  one novice-facing **Save to Obsidian** entry point.
- Add Pro Folder Share, semantic theme styling, and background Advanced Import
  with preview, cancellation, restart recovery, and the verified allowance of
  30 accepted jobs per calendar month.
- Restore complete note and folder Share management: copy, open, update,
  password, expiration, stop, and inactive-history deletion.
- Use one responsive reader shell for handwritten notes, generated media notes,
  and folders, including corrected mobile spacing and clean reader headers.
- Make the service transition one-way: former sessions are cleared, and Share
  metadata from another origin is never submitted to Bondie as an update.
- Publish current privacy, security, support, migration, and Optional payments
  disclosures with reproducible source and attested release artifacts.

## 0.0.40

- Fix the public free plugin membership refresh parser so free service responses
  without billing metadata cannot block note sharing.
- Keep the file explorer share action labeled `Share thru Docferry`.
- Rename the command palette action to `Share current note` to avoid stale
  publish wording while still satisfying Obsidian command naming rules.
- Keep the release on `https://docferry.fuyonder.tech` with public billing
  disabled.

## 0.0.39

- Remove the remaining legacy service runtime path from the public free plugin
  package.
- Force public free installs back to `https://docferry.fuyonder.tech` when an
  older or non-current service URL is found.
- Clear stale session, account, and membership state during that service reset
  so users reconnect through the current Fuyonder free service.

## 0.0.38

- Restore the public free-launch plugin line after the 0.0.36/0.0.37 paid-line
  package drift.
- Keep the free-launch UI and disabled public billing behavior from 0.0.21.
- Migrate unauthenticated installs that still point to an older service URL back
  to the current free service at `https://docferry.fuyonder.tech`.

## 0.0.21

- Add real README screenshots for the publish, reader, manage shares, settings, and import workflows.
- Add the live DocFerry preview link `https://docferry.fuyonder.tech/s/Gt5Wy3pwzY`.
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
- Restore the current DocFerry dashboard/settings UI, Fuyonder account connection, upload disclosure, request-access flow, share/import tools, and free-launch access policy integration.
- Keep public billing disabled for this release; access upgrades are handled through request review rather than Checkout.
- Update public repository metadata, privacy copy, manifests, package metadata, and versions maps to the Fuyonder release line.

## 0.0.14

- Superseded by `0.0.15`. This tag used the old community plugin line and should not be used for the June 30 public free launch.
