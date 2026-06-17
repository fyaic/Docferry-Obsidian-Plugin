# DocFerry CLI

Small Python CLI for smoke tests and local operations against a DocFerry-compatible server.

The Obsidian plugin is the primary release surface. This CLI is kept as a developer utility for server verification and import regression tests.

## Configuration

Configure the target server with command-line flags or environment variables:

```bash
export DOCFERRY_SERVER_URL="https://your-docferry-server.example.com"
export DOCFERRY_API_TOKEN="..."
```

## Commands

```bash
python cli/docferry.py health
python cli/docferry.py publish ./note.md --password "optional"
python cli/docferry.py update sh_... ./note.md --password-mode keep
python cli/docferry.py status sh_...
python cli/docferry.py events sh_... --limit 20
python cli/docferry.py revoke sh_...
python cli/docferry.py import-url https://docferry.example/s/abc123 --output ./Imported --password "optional"
```

## Scope

- The CLI operates on one share at a time.
- It does not provide a global list command.
- `import-url` reads one share URL import payload and downloads explicitly referenced attachments.
- Password-protected shares require `--password`; the CLI first calls `/s/{slug}/password` to obtain a temporary cookie.
- Attachments are written only under the `--output` import directory. Absolute paths and parent-directory traversal are normalized to safe relative paths.
