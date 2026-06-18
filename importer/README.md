# Importer

The importer restores one DocFerry share URL into a local folder or Obsidian vault.

The current release provides the import flow through the CLI and the Obsidian plugin:

```bash
python ../cli/docferry.py import-url https://share.example/s/abc123 --output /path/to/vault/Imported --password "optional"
```

## Capabilities

- Reads one share import payload from `GET /s/{slug}/import`.
- Sends a password to `/s/{slug}/password` first when the share is password protected.
- Writes imported Markdown through the CLI to a user-selected output path.
- Provides the Obsidian command `Import share URL`, which writes into the selected vault folder.
- Preserves the original Markdown body and restores explicitly referenced attachments listed in the import payload.

## Boundaries

- It does not list all shares.
- It does not infer owner, vault, folder, or sibling-share data from a URL.
- It does not scan the source vault, source folder, or nearby files.
- It downloads only assets listed in the current share asset manifest and keeps them inside the import destination.
