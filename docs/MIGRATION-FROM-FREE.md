# Moving from the free-service release

DocFerry `0.0.66` introduced a one-way upgrade of the existing Community plugin
from the retired free-service line to the full Bondie-powered product. Version
`0.0.67` preserves that boundary while adding explicit legacy-link migration
confirmation and reference preservation.

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
- Historical `df_*` metadata from another service is not sent to Bondie as an
  update. Publishing that note asks before creating a new Bondie Share and
  preserves the prior link in `df_legacy_id` and `df_legacy_url` after the user
  confirms. Cancelling leaves the old metadata unchanged.
- The plugin now includes the full Save, Share, Folder Share, theme styling,
  Dashboard, and Advanced Import experience described in the main README.

There is no hidden compatibility route or alternate production server. This
keeps account, share ownership, billing, and retention boundaries explicit.
