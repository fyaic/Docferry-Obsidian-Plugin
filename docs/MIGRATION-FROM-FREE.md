# Moving from the free-service release

DocFerry `0.0.66` is a one-way upgrade of the existing Community plugin from
the retired free-service line to the full Bondie-powered product.

## What stays the same

- The Community plugin ID remains `docferry`, so existing installations update
  in place.
- Notes and files in your vault are not removed or rewritten by the update.
- Existing public links remain governed by the service that originally issued
  them until that service is retired.

## What changes

- DocFerry now connects only to `https://docferry.bondie.io`.
- Sign in with a Bondie account after updating. A session from the former
  service is intentionally not reused.
- Historical `df_*` metadata from another service is not sent to Bondie and
  cannot be updated or stopped from the new product. Publish the note again to
  create a new Bondie Share.
- The plugin now includes the full Save, Share, Folder Share, theme styling,
  Dashboard, and Advanced Import experience described in the main README.

There is no hidden compatibility route or alternate production server. This
keeps account, share ownership, billing, and retention boundaries explicit.
