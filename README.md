<p align="center">
  <img src="plugin/docferry-logo-256.png" alt="DocFerry logo" width="132">
</p>

<h1 align="center">DocFerry</h1>

<p align="center">
  Save useful links as Markdown and share selected notes or folders without
  turning your vault into a website.
</p>

DocFerry is a desktop plugin backed by the hosted DocFerry service. Install it,
sign in with a Bondie account in your system browser, and work from one simple
home page. No server deployment, model key, or provider configuration is
required.

> **Major update:** `0.0.66` replaces the former free-service release with the
> full Bondie-powered product while keeping the existing Community plugin ID
> `docferry`. Existing users should read the
> [migration guide](docs/MIGRATION-FROM-FREE.md) and sign in again after the
> update.

## Save to your vault

Paste one public link on the DocFerry home page. DocFerry chooses the useful
path without asking you to understand implementation modes:

- a DocFerry Share is imported with its explicitly listed attachments;
- an ordinary public URL becomes a local Markdown link note;
- an enabled web, video, or audio source can become a detailed Pro note after
  background processing and preview.

Generated notes are reviewed before they are written. Advanced Import supports
the source lanes advertised by the current service, including enabled article,
YouTube, Bilibili, TikTok, Douyin, direct-video, and direct-audio sources.
Third-party source availability can change, so unsupported work fails without
silently saving a fabricated result.

## Share selected content

Publish a Markdown note from its file menu or the command palette. You can:

- keep one stable Share URL while updating the note;
- set or remove a password;
- choose an expiration;
- copy, open, update, stop, and delete inactive history;
- include explicitly referenced local images and attachments;
- inspect linked-note availability without publishing linked notes.

Pro users can also publish a selected folder of Markdown documents. Folder
Share is bounded, atomic, excludes hidden content, and has its own navigation
and lifecycle controls.

Pro theme styling carries reviewed colors, borders, callouts, radius, and code
styling into DocFerry's responsive reader. It does not upload or reproduce an
arbitrary theme layout stylesheet.

## Free and Pro

DocFerry is free to install and its core workflows remain available without a
subscription. A Pro subscription is optional and unlocks higher limits and
advanced hosted processing.

| Capability | Free | Pro |
| --- | ---: | ---: |
| Save a public URL as a local link note | Yes | Yes |
| Import a DocFerry Share | Yes | Yes |
| Publish and manage a single Markdown Share | Yes | Yes |
| Active note Shares | 5 | 20 |
| Maximum single shared file | 2 MiB | 10 MiB |
| Folder Share | No | 5 active |
| Documents per Folder Share | No | Up to 100 |
| Total Folder Share content | No | Up to 50 MiB |
| Theme styling | No | Yes |
| Advanced Import | No | 30 accepted jobs per calendar month |
| Simultaneous Advanced Imports | No | 1 |

Monthly and yearly Pro subscriptions provide the same product benefits. Plans,
billing, receipts, and support open in the DocFerry Dashboard. Personal profile,
security, devices, and privacy remain in the separate Bondie Account Center.

For Obsidian Community classification this plugin uses **Optional payments**:
Free is usable for the core product, while Pro optionally unlocks additional
features and higher limits.

## First use

1. Install and enable DocFerry from Community Plugins.
2. Open DocFerry from the ribbon.
3. Select **Sign in**. Authentication opens in the operating system's default
   browser and completes back in the plugin.
4. Paste a link on the home page, or publish a selected Markdown note from the
   file menu.
5. Open **Shares** to manage active and past note or folder Shares.

Preferences are organized into Account, Sharing, Imports, and Advanced pages.
The Sharing page includes a direct path to published content for users who do
not use the ribbon regularly.

## Privacy and trust

DocFerry does not scan or upload your vault automatically. Network actions occur
when you sign in, publish selected content, import a Share, or explicitly submit
a supported public URL for Advanced Import.

Read [PRIVACY.md](PRIVACY.md) before publishing sensitive content. It explains
the exact data flows, OpenRouter processing boundary, local state, encryption,
retention, deletion, clipboard behavior, and payment boundary.

- Hosted service: `https://docferry.bondie.io`
- Privacy: `https://docferry.bondie.io/privacy`
- Terms: `https://docferry.bondie.io/terms`
- Support: `https://docferry.bondie.io/dashboard/support`
- Security reports: [SECURITY.md](SECURITY.md)

## Manual installation

Most users should install from Community Plugins. For a controlled manual
installation, download these three separate assets from the matching GitHub
Release and place them in `.obsidian/plugins/docferry/`:

```text
manifest.json
main.js
styles.css
```

The release tag must exactly match the manifest version, without a `v` prefix.

## Build and review

```bash
npm ci
npm --prefix plugin ci
npm run check:release
```

`check:release` runs the official-style ESLint rules, 70 client tests, a clean
TypeScript bundle, `node --check`, metadata and license checks, domain-boundary
checks, and a public-source scan. The release workflow rebuilds from source and
attests `main.js`, `manifest.json`, and `styles.css` before publishing.

The hosted backend, provider configuration, billing infrastructure, operator
tools, and production secrets are intentionally not part of this public client
repository.

## License

The public DocFerry plugin client is released under the [MIT License](LICENSE).
