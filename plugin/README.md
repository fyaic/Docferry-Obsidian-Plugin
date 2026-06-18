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
- List account shares from the selected service in plugin settings, with local vault records merged when available.
- Write `df_*` frontmatter fields used to update, copy, or stop a share later.
- Upload explicitly referenced local images and attachments through the configured DocFerry server.
- Capture a bounded Obsidian HTML and CSS reading-view snapshot.
- Use DocFerry Cloud by default without asking users for a server URL.
- Show active-share quota status when the selected service supports `GET /v0/account`.

## Free Plugin Boundary

This branch is the free and open-source plugin line. It does not expose team-login, SSO, paid-license, or paid hosted-account flows. Users can connect to DocFerry Cloud anonymously inside the plugin, or switch to a custom self-hosted DocFerry-compatible server.

In DocFerry Cloud mode, users do not configure a server URL, sign in, use OAuth, or copy/paste a token. The settings tab includes a `Connect DocFerry Cloud` button that claims a free anonymous Cloud token and stores it locally in this vault's plugin data.

DocFerry Cloud includes 5 active shares for the free plugin path. A stopped or expired share does not count toward that active-share quota. Custom servers control their own quotas.

DocFerry Cloud uses encrypted-at-rest storage for note body fields and object bytes. The DocFerry server decrypts content when serving share pages, assets, and import payloads. The settings tab links to the public privacy notice under `Service mode`, and stopping a share revokes access and removes that share's server-side content and non-reused object bytes.

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
