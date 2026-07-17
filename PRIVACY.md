# DocFerry Privacy

DocFerry is an Obsidian plugin and hosted service for sharing an explicitly
selected note or Pro folder through a read-only web link.

## What Leaves Your Device

DocFerry does not upload a vault automatically. Network requests occur only
when you use account, share, import, support, or billing features.

| Feature | Data sent | User control |
| :--- | :--- | :--- |
| Bondie account connection | Product login callback, product session, and low-sensitivity plugin instance context | Connect, switch, or disconnect from the Account page |
| Note sharing | Selected note title and content, bounded rendered snapshot and reading styles, explicitly referenced assets, selected password/expiration options, and share metadata | Confirm each publish; update or stop it later |
| Pro Folder Share | Files inside the explicitly selected folder, bounded navigation metadata, included assets, selected theme/password/expiration options, and revision metadata | Confirm the exact folder; update or stop it later |
| Share management | Owner-scoped share list and requested update/stop actions | Use `My shares` |
| DocFerry import | Supplied share URL, optional document password, and import/download requests | Choose the URL; imported files remain local |
| Public web or media link | The supplied URL; detailed processing only when the user chooses it and the runtime advertises an enabled provider | Keep the default link-only note or explicitly request a detailed note |
| Clipboard | No clipboard content is sent | The plugin writes a share URL after publish/copy and never reads the clipboard |

DocFerry does not upload unrelated notes, unpublished linked notes, or content
outside a selected folder. A Folder Share is not implemented by silently
publishing a collection of independent note links.

## Local Storage

The plugin stores settings in Obsidian plugin data. This can include a product
session, local client instance identifier, display-only account cache,
membership cache, default publish/import settings, and disclosure acceptance
version. It does not store Auth0 raw tokens, Stripe card data, webhooks, or
managed AI-provider credentials.

Published notes receive `df_*` properties that identify their share and update
state. Imported notes and explicitly returned assets are written to the local
folder selected by the plugin workflow.

## Hosted Service

The production service is `https://docferry.bondie.io`. Active share content
and required assets are stored to serve the link. Bondie Account at
`https://account.bondie.io` owns login, account security, devices, privacy, and
billing. Managed model-provider credentials remain server-side.

Stopping a share makes its public link unavailable. Someone who already had
access may have viewed, downloaded, or copied the material before it was
stopped.

## Payments

The plugin is free to install and includes a Free service tier. Optional Pro
subscriptions unlock additional service capabilities and limits. Checkout,
receipts, subscription management, cancellation, and refunds are handled by
Bondie Account and Stripe. DocFerry receives projected product access state,
not card details.

## Diagnostics And Support

Debug logging is off by default and remains in the local Obsidian developer
console. The plugin does not automatically upload diagnostic bundles. Do not
send private notes, passwords, session tokens, or active private share links in
support requests.

- Support: `support@bondie.io`
- Privacy: `https://docferry.bondie.io/privacy`
- Terms: `https://docferry.bondie.io/terms`
