<p align="center">
  <img src="plugin/docferry-logo-256.png" alt="DocFerry logo" width="128">
</p>

<h1 align="center">DocFerry</h1>

<p align="center">
  Share a note or a Pro folder from Obsidian as a secure, read-only web link.
</p>

DocFerry is designed for deliberate sharing. It publishes only the note or
folder you choose. It does not turn your vault into a website and does not scan
unrelated vault content.

Production service: [docferry.bondie.io](https://docferry.bondie.io)

## Start Here

1. Install and enable DocFerry in Obsidian.
2. Open the DocFerry ribbon icon.
3. Connect a Bondie account.
4. Open a Markdown note and choose `Share note`.
5. Send the copied link. Return to `My shares` whenever you need to update or
   stop it.

The same home screen can import a DocFerry share or save a public web link as a
local Markdown note.

## What It Can Do

- Publish or update one selected Markdown note without changing its URL.
- Add an optional document password or expiration date.
- Render the selected note, bounded reading styles, and explicitly referenced
  local assets in a read-only browser page.
- Import one DocFerry share and its explicitly listed assets into the current
  vault.
- Copy, open, update, and stop links from `My shares`.
- Publish one explicitly selected folder as a navigable Pro share.
- Apply a bounded full-theme snapshot to a Pro folder, with a safe reader-theme
  fallback when a theme cannot be captured safely.
- Refresh membership after Checkout or Account Center changes.

Folder sharing never falls back to publishing many unrelated note links. If the
account or service cannot authorize the folder capability, DocFerry stops and
explains that Pro is required.

## Free And Pro

The plugin is free to install. A connected account can use the basic
single-note workflow within the Free limits shown in the plugin. Optional Pro
subscriptions add Folder Share, Full Theme, and higher service limits.

Current plans are shown before Checkout in the DocFerry dashboard. Billing and
receipts are handled by Bondie Account and Stripe; DocFerry never receives card
details.

## Web And Media Links

Pasting a normal public URL always supports a local link-only note. A more
detailed server-generated note is shown only when both the account and the
DocFerry runtime explicitly enable a qualified provider. Provider credentials
never enter the plugin.

## Privacy Boundary

- Nothing is uploaded merely because the plugin is installed or a vault opens.
- Sharing starts only after you select a note or folder and confirm the publish
  dialog.
- A Folder Share reads only that selected folder and its included files.
- Import consumes one supplied URL; it does not inspect the sender's vault.
- The plugin writes share links to the clipboard only after a share or copy
  action. It never reads clipboard contents.

Read [PRIVACY.md](PRIVACY.md) before publishing sensitive material.

## Support And Policies

- Support: [support@bondie.io](mailto:support@bondie.io)
- Privacy: [docferry.bondie.io/privacy](https://docferry.bondie.io/privacy)
- Terms: [docferry.bondie.io/terms](https://docferry.bondie.io/terms)
- Account Center: [account.bondie.io/account](https://account.bondie.io/account)

## Manual Install

Download `manifest.json`, `main.js`, and `styles.css` from the matching GitHub
Release and place them in:

```text
.obsidian/plugins/docferry/
```

Restart Obsidian or disable and re-enable DocFerry after replacing the files.

## Build And Test

```bash
npm ci
npm --prefix plugin ci
npm run lint
npm run test:plugin
npm run check:plugin
```

The release tag, root manifest, plugin manifest, package versions, and release
assets must all use the same semantic version.
