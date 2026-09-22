# DocFerry Plugin Package

This directory contains the reviewable source, tests, build configuration, and
runtime assets for the DocFerry desktop plugin.

## Candidate Status

- Community plugin id: `docferry`
- Candidate version: `0.0.74` (draft pending product-team approval)
- Latest published GitHub Release: `0.0.73`
- Minimum desktop app version: `1.12.7`
- Hosted service: `https://docferry.bondie.io`
- Community classification: **Optional payments**

Free users can save public links, import DocFerry Shares, and publish or manage
single-note Shares. Pro adds Folder Share, theme styling, higher Share limits,
and 30 Advanced Imports per calendar month. Users never configure a model or
provider key.

## Build And Test

From the public repository root:

```bash
npm ci
npm --prefix plugin ci
npm run lint
npm run test:plugin
npm run build
npm run check:release
```

`plugin/main.js` is generated from `plugin/src`. The three runtime assets are
`main.js`, `manifest.json`, and `styles.css`; a future release tag must exactly
match the manifest version. The tag workflow produces an attested draft for
maintainer review, not an automatically published release.

Version 0.0.74 restores the complete Account, Sharing, Imports, and Advanced
pages on Obsidian 1.13+. The incomplete native search definitions from 0.0.73
are withdrawn because they replaced the full page. Preferences remain editable
in the plugin settings; this correction does not change stored data or login.

## Trust Boundary

DocFerry reads or publishes only content the user explicitly selects. Product
login opens in the operating system browser, session custody uses Obsidian
SecretStorage, and the production service URL is fixed. Historical service
origins are not accepted as current Share update targets.

Review the repository-level [README](../README.md), [privacy notice](../PRIVACY.md),
[security policy](../SECURITY.md), [support guide](../SUPPORT.md), and
[free-to-paid migration guide](../docs/MIGRATION-FROM-FREE.md) before promotion.
