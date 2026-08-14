# DocFerry Privacy

DocFerry is a desktop plugin and hosted service for saving public links as
Markdown, importing DocFerry Shares, preparing supported web or media notes,
and publishing explicitly selected notes or folders.

## What leaves your device

DocFerry does not upload your vault automatically. Network requests happen
only when you use account, Share, import, or access features.

| Feature | Default | Local files written | Data sent off device | User control |
| --- | --- | --- | --- | --- |
| Account connection | Off until sign-in | Product session and display-only account cache in plugin data | Login completion data and low-sensitivity plugin instance context | Disconnect in Preferences or disable the plugin |
| Publish Share | User-triggered | `df_*` metadata on the selected note | Selected title, body, rendered snapshot, explicitly referenced assets, chosen Share options, and client metadata | Publish only content you choose; stop sharing later |
| Share management | User-triggered | No note content unless a Share is updated or stopped | Owner-scoped list and status requests | Use Shares or the Dashboard |
| Import DocFerry Share | User-triggered | Imported note and listed assets in the selected folder | Share URL, optional password, and bounded import requests | Choose the output folder; delete local files at any time |
| Save ordinary public link | User-triggered | Local Markdown link note | None; the target page is not requested | Delete the local note at any time |
| Advanced Import | Pro and user-triggered | Previewed Markdown only after confirmation | Selected public URL, bounded source content, and temporary processing artifacts | Review, cancel before saving, or delete the local note |
| Clipboard copy | User-triggered | None | None | Writes Share links; never reads clipboard contents |
| Debug logging | Off | Local developer console | Nothing is sent automatically | Keep disabled unless troubleshooting |

## Published content

Publishing can send the selected note content, rendered HTML snapshot, bounded
semantic theme tokens, explicitly referenced local images or attachments,
title, source-path metadata, and plugin/client version metadata. Theme tokens
can preserve reviewed colors, borders, radius, text, callout, and code styling;
DocFerry does not upload an arbitrary theme layout stylesheet. Linked notes are
not uploaded unless you publish them separately.

Stopping a Share makes its link unavailable, but anyone who previously had
access may already have viewed or copied the content.

## Local storage

Plugin data can include the fixed production service URL, local client
instance ID, product session token, display-only account and membership cache,
publish/import defaults, privacy-disclosure acceptance, and owner-scoped state
for an unfinished Advanced Import so it can be cancelled or resumed after a
restart.

Share metadata is written to the selected note frontmatter using `df_*` keys.
An import validates and downloads all listed assets before committing the note;
if a later write fails, files it would have overwritten are restored.

The bundled upload SDK may use browser local or session storage for temporary
asset upload state. DocFerry account tokens are not stored there by the plugin.

## Hosted service

DocFerry operates at `https://docferry.bondie.io`. Authentication and account
identity are provided by Bondie. Connections use HTTPS.

Published content, rendered snapshots, selected assets, and sensitive Share
metadata are encrypted at rest with server-managed versioned keys. Sensitive
lookup values use keyed blind indexes where appropriate, and Share passwords
use one-way password hashes.

This is server-side encryption, not end-to-end or zero-knowledge encryption.
DocFerry must decrypt content in service memory to render an authorized Share,
return an import, or let its owner manage it.

The service stores hashed product session tokens and only the encrypted,
same-user account credentials required for product account and billing
functions. The plugin does not receive Auth0 management credentials, Stripe
secrets, webhooks, or managed-AI provider keys.

Public Share routes can record low-sensitivity events for owner support,
password-abuse controls, and security diagnosis. These can include a Share or
folder identifier, public slug, event type, request ID, HTTP status, salted
reader-IP hash, bounded user-agent string, and timestamp. Reader IP addresses
are not stored in plaintext and public readers are not assigned an account
identity.

## Advanced Import and OpenRouter

When you submit a supported public page or media link, normal articles can use
deterministic extraction. Supported audio or video may be routed through
OpenRouter to a server-selected model using the public URL or bounded media
content. OpenRouter and the selected downstream model provider process that
input to produce the requested note.

DocFerry does not accept a user provider key and does not send your Bondie
identity, vault token, browser cookies, history, profile, or unrelated vault
files to the model provider. Temporary source artifacts and results are
encrypted, owner-scoped, and removed under the retention policy. A result is
previewed before the plugin writes it into your vault.

## Retention and deletion

- Active note and Folder Shares remain available while active.
- Stopped or expired content becomes unavailable immediately and its primary
  content is cleared after the configured inactive-content period, currently
  30 days by default.
- Unreferenced assets and incomplete folder revisions become eligible for
  deletion after 7 days by default.
- Share access events are removed after 90 days by default.
- Database and object-storage backups are pruned after 30 days by default,
  subject to the configured minimum recovery set.
- Deleting an inactive history row removes it from the product view; events
  and backups continue to age out under their normal retention periods.
- Expired Advanced Import jobs have source URL, result, warning, and error
  details purged. Low-sensitivity aggregate usage remains for quota, cost, and
  abuse controls.

## Payments

DocFerry plan management uses the approved Bondie billing flow. The plugin does
not collect card details. For Obsidian Community classification DocFerry uses
**Optional payments**: Free remains usable for core Save, Share Import, and
single-note Share workflows; Pro optionally unlocks additional capabilities
and higher limits.

## Diagnostics and support

The plugin does not automatically send diagnostic bundles. Do not share notes,
tokens, passwords, private Share links, or payment data in support requests
unless you intentionally choose to include the relevant information.

- Privacy policy: `https://docferry.bondie.io/privacy`
- Terms: `https://docferry.bondie.io/terms`
- Support: `support@bondie.io`
