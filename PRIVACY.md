# DocFerry Privacy

DocFerry is an Obsidian plugin and hosted sharing service for publishing one selected note to one secure web share link.

## What Leaves Your Device

DocFerry does not upload your vault automatically. Network requests happen only when you use account, share, import, or access features.

| Feature | Default | Local Files Written | Data Sent Off Device | User Control |
| :--- | :--- | :--- | :--- | :--- |
| Account connection | Off until you sign in | Obsidian plugin data stores the session token and display-only account cache | Login callback data and low-sensitivity plugin instance context | Disconnect in DocFerry settings or disable the plugin |
| Publish share | User-triggered | `df_*` frontmatter metadata on the published note | Selected note title, note body/rendered snapshot, explicitly referenced local assets, selected password/expiration options, share metadata | Publish only notes you choose; stop sharing later |
| Share management | User-triggered | No note content written unless you update/stop a share | Share list/status requests for the connected account | Use settings or dashboard actions |
| Import share URL | User-triggered | Imported note and listed assets in the folder you choose | Share URL, optional share password, import/download requests | Choose the output folder; delete imported files locally |
| Clipboard copy | User-triggered | None | None | The plugin writes share links to the clipboard; it does not read clipboard contents |
| Debug logging | Off by default | Local Obsidian developer console only | None by the plugin | Keep debug logging disabled unless troubleshooting |

## Published Content

When you publish, DocFerry can receive the selected note content, rendered HTML snapshot, a bounded CSS theme snapshot, explicitly referenced local images or attachments, the note title, source path metadata, and plugin/client version metadata. Linked notes are not uploaded unless you publish them separately.

Stopping a share makes the link unavailable, but anyone who had access may already have viewed or copied the content.

## Local Storage

The plugin stores settings in Obsidian plugin data on your device. This can include server URL, local client instance id, account session token, display-only account cache, membership cache, default publish/import settings, and the upload disclosure acceptance timestamp.

DocFerry writes share metadata to the published note frontmatter using `df_*` keys. Imported shares are written only to the folder you choose.

When you publish explicitly referenced local images or attachments, the bundled cloud upload SDK may use browser local or session storage for upload state. DocFerry plugin settings and account tokens are not stored there by the plugin.

## Hosted Service

DocFerry operates a hosted sharing service at `https://docferry.fuyonder.tech`. The service stores published content and assets needed to serve active share links. Authentication is handled through Fuyonder account infrastructure.

## Payments

The current public plugin build is free to install. Public billing is disabled in this release. Future paid access or hosted-service plans will require updated product copy, privacy terms, release notes, and user-facing controls before public launch.

## Diagnostics And Support

The plugin does not automatically send diagnostic bundles. Do not share notes, tokens, passwords, or private share links in support requests unless you intentionally choose to include them.
