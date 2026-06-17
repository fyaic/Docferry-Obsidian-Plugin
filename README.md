# DocFerry

<p align="center">
  <img src="assets/docferry-logo.png" alt="DocFerry logo" width="128">
</p>

DocFerry is a free and open-source Obsidian plugin for publishing exactly one note as a secure share link. It is designed to work with DocFerry Cloud by default, including a free quota of 10 active shares, while still allowing users to connect a custom self-hosted server.

[Website](https://bondie.io/research/docferry)

```text
one Obsidian note -> one secure share URL
```

DocFerry is intentionally not a folder publisher, vault publisher, public directory, or digital garden. Readers can only open the document behind the share URL they receive. Internal links are resolved only when the target note has also been published through DocFerry.

## Status

This branch standardizes DocFerry for an Obsidian Community plugin submission and the DocFerry Cloud free-quota launch path.

- Plugin name: `DocFerry`
- Plugin ID: `docferry`
- Author: `Bondie Labs`
- Website: [bondie.io/research/docferry](https://bondie.io/research/docferry)
- License: MIT
- Obsidian Community payment label posture: Optional payments if DocFerry Cloud is listed as the default hosted service
- Developer-operated paid features: none implemented in this branch
- Hosted service mode: DocFerry Cloud token, 10 active shares included
- Self-hosted mode: custom DocFerry-compatible server URL and token

## What It Does

- Publish the active Markdown note to DocFerry Cloud or a configured DocFerry-compatible server.
- Update an existing share link for the current note.
- Copy the current note's share link.
- Stop sharing the current note.
- Import a single DocFerry share URL into the current vault.
- Show whether linked notes are published, unpublished, ambiguous, or unsupported.
- Upload explicitly referenced local assets for the published note.
- Capture a bounded Obsidian reading-view HTML and CSS snapshot for the share page.
- Write local share metadata to frontmatter so the same note can be updated or stopped later.
- Show account quota status when the selected service supports `GET /v0/account`.

## What It Does Not Do

- It does not publish folders, full vaults, or a public site.
- It does not create a searchable public directory.
- It does not scan unrelated notes for upload.
- It does not require payment to Bondie Labs.
- It does not provide end-to-end encryption or zero-knowledge hosting.
- It does not connect directly from the plugin to vendor object-storage SDKs.
- It does not send note content anywhere until you test a connection, publish or update a share, stop a share, check linked-note status, or import a share.

## Requirements

- Obsidian `1.4.0` or later.
- Desktop Obsidian. The plugin uses desktop-only APIs and is marked `isDesktopOnly: true`.
- Cloud mode: a DocFerry Cloud token. No custom server URL is required.
- Custom mode: a DocFerry-compatible server URL and API token.

You can self-host the server from this repository. If you use a server operated by someone else, that server operator controls its storage, retention, availability, and terms.

## Settings

- `Service mode`: Choose DocFerry Cloud or a custom self-hosted server.
- `Cloud token` / `Server token`: A token for the selected service. It is stored locally in this vault's Obsidian plugin data.
- `Server URL`: Shown only in custom mode.
- `Password by default`: Preselects password protection in the publish dialog.
- `Default expiration`: Sets the initial expiration option in the publish dialog.
- `Debug logging`: Writes limited publish diagnostics to the developer console when enabled.

## Privacy

Read [PRIVACY.md](PRIVACY.md) before publishing sensitive notes. The plugin also links to the public privacy notice from the settings tab, directly under `Service mode`. In short: the plugin sends only the note and explicitly referenced assets you choose to publish, and only to the selected DocFerry service. DocFerry Cloud stores note body and object bytes encrypted at rest, but the server decrypts them to render share pages and import payloads. This is not end-to-end encryption. Stop sharing revokes the public URL and removes that share's server-side content and non-reused object bytes. Bondie Labs does not receive your vault data when you self-host.

## Development

```bash
cd plugin
npm ci
npm run build
node --check main.js
```

Server tests:

```bash
cd server
uv run --extra dev pytest
```

## Release Artifacts

An Obsidian release must attach:

- `manifest.json`
- `main.js`
- `styles.css`

The GitHub release tag must match the version in `manifest.json`.
