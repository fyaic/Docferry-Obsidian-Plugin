# DocFerry plugin source

This directory contains the reviewable TypeScript source, tests, styles,
runtime manifest, and bundled `main.js` for the DocFerry Community plugin.

For installation, product features, Free and Pro limits, privacy, the `0.0.40`
to `0.0.66` product migration, and the `0.0.67` corrective release, read the
repository [README](../README.md).

Build and test from the repository root:

```bash
npm ci
npm --prefix plugin ci
npm run check:release
```

The official release contains only `manifest.json`, `main.js`, and
`styles.css`. The hosted service and its operator configuration are not part
of this public client repository.
