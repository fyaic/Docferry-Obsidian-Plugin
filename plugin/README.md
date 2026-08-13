# DocFerry Plugin Package

This directory contains the source, tests, manifest, styles, and generated
bundle for the DocFerry Community plugin.

- Plugin id: `docferry`
- Version: `0.0.37`
- Production service: `https://docferry.fuyonder.tech`
- Account provider: Bondie Account
- Callback protocols: `obsidian://docferry-auth` and `obsidian://docferry`

User documentation and the privacy boundary are maintained in the repository
[README](../README.md) and [PRIVACY](../PRIVACY.md).

## Build And Test

```bash
npm ci
npm test
npm run build
node --check main.js
```

The installable Community release contains the root `manifest.json` together
with this directory's generated `main.js` and `styles.css`.
