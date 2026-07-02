<p align="center">
  <img src="plugin/docferry-logo-256.png" alt="DocFerry logo" width="156">
</p>

<h1 align="center">DocFerry</h1>

<p align="center">
  Publish one selected note to one secure DocFerry share link.
</p>

```text
one selected note -> one secure share URL
```

DocFerry does not publish an entire folder, vault, digital garden, or public directory. Linked notes are not uploaded unless the user publishes them separately.

## Release Status

- Hosted service: `https://docferry.fuyonder.tech`
- Account system: Fuyonder account
- Free quota: connected accounts receive a free 5-document quota from the hosted service
- More quota: users can request extra free quota from the beta list flow in settings
- Billing: public billing controls are not active in the plugin UI
- Legal pages: hosted service provides `https://docferry.fuyonder.tech/privacy` and `https://docferry.fuyonder.tech/terms`
- Versioning: the GitHub release tag, root `manifest.json`, and `plugin/manifest.json` must match

If paid access or hosted-service billing is enabled later, update the README, privacy notice, release notes, product UI copy, and review evidence in the same release.

## What The Plugin Does

- Publishes the current Markdown note to a DocFerry share link.
- Updates, copies, and stops an existing share.
- Shows share status for the current note.
- Imports one DocFerry share URL into a user-selected vault folder.
- Connects to a Fuyonder account for share ownership, free quota, and account-protected sharing.
- Shows account, shares, import, settings, and quota status in the plugin dashboard/settings.
- Lets users request more free quota from the account settings flow.
- Shows an upload disclosure before publishing vault content.

## Privacy Boundary

The plugin does not upload your vault automatically. When a user publishes, DocFerry can upload the selected note, rendered HTML snapshot, bounded CSS snapshot, explicitly referenced local assets, and share metadata needed to serve the link.

Read [PRIVACY.md](PRIVACY.md) before publishing sensitive notes.

## Manual Install

Use the latest GitHub Release and copy the plugin files into:

```text
.obsidian/plugins/docferry/
```

Required runtime files:

```text
manifest.json
main.js
styles.css
```

GitHub releases should attach only the assets that Obsidian downloads: `manifest.json`, `main.js`, and `styles.css`.

## Build

From a clean checkout:

```bash
npm ci
npm --prefix plugin ci
npm run check:plugin
```

Plugin-only build:

```bash
cd plugin
npm ci
npm run build
node --check main.js
```

## Release Review Notes

- `manifest.json` is mirrored at the repository root for Obsidian review.
- `plugin/manifest.json` is the runtime manifest included in the installable plugin package.
- `package.json` and `tsconfig.json` at the repository root exist so automated review tools can resolve Obsidian, CodeMirror, and runtime SDK types in this plugin-subdirectory layout.
- The plugin is desktop-only because this release targets desktop Obsidian plugin packaging.
- The manifest description intentionally avoids the word "Obsidian"; the Community directory already provides that context.
