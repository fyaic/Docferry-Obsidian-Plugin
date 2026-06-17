# DocFerry Plugin

<p align="center">
  <img src="../assets/docferry-logo.png" alt="DocFerry logo" width="128">
</p>

This directory contains the Obsidian plugin source and bundled artifacts.

Public plugin identity:

- Manifest ID: `docferry`
- Display name: `DocFerry`
- Author: `Bondie Labs`
- Website: [bondie.io/research/docferry](https://bondie.io/research/docferry)
- Version: `0.0.6`
- License: MIT

## Capabilities

- Publish the active Markdown note as a secure DocFerry share link.
- Update, copy, and stop the current note's share link.
- Import one DocFerry share URL into the current vault.
- Show linked-note status for the current published note.
- Write `df_*` frontmatter fields and read legacy `docferry_share_*` and `fuyou_share_*` fields for migration.
- Upload explicitly referenced local images and attachments through the configured DocFerry server.
- Capture a bounded Obsidian HTML and CSS reading-view snapshot.
- Use DocFerry Cloud by default when the public Cloud endpoint is configured.
- Show active-share quota status when the selected service supports `GET /v0/account`.

## Free Plugin Boundary

This branch is the free and open-source plugin line. It does not expose team-login, SSO, paid-license, or paid hosted-account flows. Users can publish with DocFerry Cloud using a manually issued Cloud token, or switch to a custom self-hosted DocFerry-compatible server.

DocFerry Cloud includes 10 active shares for the free plugin path. A stopped or expired share does not count toward that active-share quota. Custom servers control their own quotas.

DocFerry Cloud uses encrypted-at-rest storage for note body fields and object bytes. This is server-side encryption, not end-to-end encryption or zero-knowledge hosting. The settings tab links to the public privacy notice under `Service mode`, and stopping a share revokes access and removes that share's server-side content and non-reused object bytes.

## Development

```bash
npm ci
npm run build
node --check main.js
```

Release artifacts are:

- `manifest.json`
- `main.js`
- `styles.css`
