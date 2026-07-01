# DocFerry

DocFerry publishes one selected Obsidian note to one secure web share link.

```text
one Obsidian note -> one secure share URL
```

DocFerry does not publish an entire folder, vault, digital garden, or public directory. Linked notes are not uploaded unless the user publishes them separately.

## Current Release

- Obsidian plugin version: `0.0.17`
- Hosted service: `https://docferry.fuyonder.tech`
- Public account system: Fuyonder account
- Public billing: disabled in this release
- Free access limits: enforced by the hosted DocFerry service

This is the June 30 public free launch build. Paid access and hosted-service billing are disabled in the public plugin flow and require a future release with updated product copy, privacy terms, and review evidence.

## What The Plugin Does

- Publishes the current Markdown note to a DocFerry share link.
- Updates, copies, and stops an existing share.
- Shows share status for the current note.
- Imports one DocFerry share URL into a user-selected vault folder.
- Connects to a Fuyonder account for share ownership and access limits.
- Shows account, shares, import, and access status in the plugin dashboard/settings.
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

```bash
npm install --package-lock-only --ignore-scripts
npm run check:plugin
```

Plugin-only build:

```bash
cd plugin
npm install --package-lock-only --ignore-scripts
npm run build
node --check main.js
```

## Release Review Notes

- `manifest.json` is mirrored at the repository root for Obsidian review.
- `plugin/manifest.json` is the runtime manifest included in the installable plugin package.
- `package.json` and `tsconfig.json` at the repository root exist so automated review tools can resolve Obsidian and CodeMirror types in this plugin-subdirectory layout.
- The plugin is desktop-only because this release targets desktop Obsidian plugin packaging.
