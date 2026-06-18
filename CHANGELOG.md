# Changelog

## 0.0.6

- Standardize the free and open-source Obsidian plugin identity as DocFerry by Bondie Labs.
- Rename the public plugin ID to `docferry`.
- Remove public SSO and team-login entry points from the free plugin branch.
- Route asset uploads through the configured DocFerry server instead of a vendor object-storage SDK in the plugin.
- Add DocFerry logo assets and the official project website link.
- Add root release files for Obsidian Community preparation.
- Add DocFerry Cloud service mode with anonymous in-plugin token claim.
- Add free Cloud quota copy for 5 active shares, with stopped and expired shares excluded from the active count.
- Add a plugin settings share management area for account-level DocFerry shares, with local vault records merged when available.
- Add Cloud account status support through `GET /v0/account`.
- Add server-side encrypted-at-rest storage for note body fields and object bytes.
- Update privacy copy for encrypted-at-rest storage and DocFerry Cloud server rendering boundaries.
