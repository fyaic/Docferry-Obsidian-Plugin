# Privacy

DocFerry publishes only the note you choose and the explicitly referenced assets needed to render that note.

## Who Receives Data

The plugin sends data to the DocFerry service selected in settings.

- In DocFerry Cloud mode, the plugin sends publish, update, stop, account-status, linked-note-status, and import requests to the DocFerry Cloud endpoint operated by Bondie Labs.
- In Custom server mode, the plugin sends requests to the server URL you configure.
- If you self-host DocFerry, Bondie Labs does not receive your vault data, API token, note content, assets, share metadata, diagnostics, or logs.

If you use a server operated by another person or organization, that server operator controls its storage, retention, access, availability, and terms.

## Data Sent When Publishing

When you publish or update a note, the plugin may send:

| Data | Sent by default | Notes |
| :--- | :--- | :--- |
| Note title | Yes | Defaults to the Obsidian file name and can be edited before publishing. |
| Note markdown | Yes | The full body of the selected note is sent to the configured server. |
| HTML snapshot | Yes, when rendering succeeds | Generated locally from Obsidian's reading view. |
| CSS snapshot | Yes, when available | Bounded to a size limit and skips CSS rules that contain `url(...)`. |
| Source path | Yes | Used for update, import, and link-resolution metadata. |
| Vault identifier | Yes | A local hash derived from vault identity; used for link-resolution boundaries. |
| Explicitly referenced assets | Yes, when present | Images and attachments referenced by the selected note can be uploaded. |
| Outbound note links | Yes | Used to report linked-note status and resolve already-published internal links. |
| Share password | Only if enabled | Sent to the configured server so it can protect the share. |
| Expiration time | Only if selected | Sent to the configured server so it can expire the share. |

## Data Sent When Importing

When you import a DocFerry share URL, the plugin requests that share's import payload from the share URL host. If the share is password protected, the password is sent to that host for verification.

Imported notes and assets are written under the destination folder you select in your vault.

## Local Storage

The plugin stores settings in this vault's local Obsidian plugin data, including:

- Service mode
- Server URL, when Custom server mode is used
- Cloud token or server token
- Default password setting
- Default expiration setting
- Debug logging setting

The plugin also writes share metadata to the published note's frontmatter so the note can be updated, copied, or stopped later.

## Server Storage And Encryption

DocFerry Cloud stores note body fields and object bytes using server-side encrypted-at-rest storage. The current implementation encrypts `Share.markdown`, `Share.html_snapshot`, and stored asset/object bytes with AES-GCM envelopes.

This is not end-to-end encryption, client-side encryption, or zero-knowledge hosting. The DocFerry server decrypts content to render share pages, serve assets, verify imports, and return import payloads.

Some metadata remains plaintext so the service can route, expire, stop, count, and resolve shares:

- Owner/account ID
- Share ID and slug
- Title
- Source path and normalized source path
- Status, stopped time, expiration time, and timestamps
- Asset metadata such as hash, content type, byte length, role, and original path
- Link-resolution metadata
- Active-share quota counts

Passwords are not stored as plaintext. When password protection is enabled, the server stores a password hash.

DocFerry Cloud tokens are not stored as plaintext by the server. Cloud tokens are stored as HMAC-SHA256 hashes and are shown only when issued.

## Stopping Sharing And Deleting Server Content

When you use **Stop sharing** in the plugin, the plugin sends `DELETE /v0/shares/{share_id}` to the selected DocFerry service.

On DocFerry Cloud, this revokes public access to the share and removes the server-side content for that share:

- Inline stored markdown and HTML snapshots are cleared.
- Object-stored markdown and HTML snapshot files are deleted when they are no longer referenced by another active share.
- Uploaded note assets are unlinked from the stopped share and deleted when they are no longer referenced by another active share.
- The share password hash, link-resolution index, asset manifest, and share access events for that share are cleared.

If the same uploaded asset is still used by another active share from the same account, DocFerry Cloud keeps that object so the other active share continues to work. The object is deleted after the last active reference is stopped or replaced.

DocFerry Cloud keeps minimal operational metadata after a share is stopped so the service can report that the link was revoked and avoid serving the old URL. This includes the account/owner ID, share ID, slug, stopped timestamp, created/updated timestamps, and a redacted title/source marker. It does not keep the stopped note body, HTML snapshot, password hash, asset manifest, or non-reused asset bytes.

## Network Control

The plugin does not send note content when it is merely enabled. Network requests happen when you:

- Test the server connection
- Publish or update a note
- Stop sharing a note
- Check linked-note status
- Import a share URL

To stop network use, clear the token, switch to an unreachable custom server URL, or disable the plugin.

## Diagnostics

Debug logging is off by default. When enabled, it writes limited publish diagnostics to the Obsidian developer console. Do not share console output publicly unless you have reviewed it for sensitive note names, file paths, or server details.
