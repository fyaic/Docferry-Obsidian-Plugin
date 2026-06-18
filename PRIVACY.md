# Privacy

DocFerry publishes only the note you choose and the explicitly referenced assets needed to render that note.

## Who Receives Data

The plugin sends data to the DocFerry service selected in settings.

- In DocFerry Cloud mode, the plugin sends anonymous claim, publish, update, stop, account-status, linked-note-status, and import requests to the DocFerry Cloud endpoint operated by Bondie Labs.
- In Custom server mode, the plugin sends requests to the server URL you configure.
- If you self-host DocFerry, Bondie Labs does not receive your vault data, API token, note content, assets, share metadata, diagnostics, or logs.

If you use a server operated by another person or organization, that server operator controls its storage, retention, access, availability, and terms.

## Data Sent When Connecting To DocFerry Cloud

When you connect to DocFerry Cloud, the plugin may send:

| Data | Purpose | Storage |
| :--- | :--- | :--- |
| Random install ID | Claim the free Cloud token and apply abuse limits | The server stores only an HMAC hash. |
| Plugin version | Compatibility and support diagnostics | May be recorded with the claim event. |
| Obsidian version | Compatibility and support diagnostics | May be recorded with the claim event. |
| Basic client platform | Compatibility and support diagnostics | May be recorded with the claim event. |
| IP-derived rate-limit hash | Abuse prevention | The server stores a hash for rate limiting. |

The random install ID is generated locally by the plugin. It is not based on your hardware, vault name, vault path, operating-system username, or machine name.

## Data Sent When Publishing

When you publish or update a note, the plugin may send:

| Data | Sent by default | Notes |
| :--- | :--- | :--- |
| Note title | Yes | Defaults to the Obsidian file name and can be edited before publishing. |
| Note markdown | Yes | The full body of the selected note is sent to the configured server. |
| HTML snapshot | Yes, when rendering succeeds | Generated locally from Obsidian's reading view. |
| CSS snapshot | Yes, when available | Bounded to a size limit and skips CSS rules that contain `url(...)`. |
| Source path | Yes | Used for update, import, and link-resolution metadata; stored encrypted on DocFerry Cloud with blind indexes where matching is needed. |
| Vault identifier | Yes | A local hash derived from vault identity; stored encrypted on DocFerry Cloud with a blind index for link-resolution boundaries. |
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
- Random anonymous install ID for DocFerry Cloud
- Cloud token or server token
- Default password setting
- Default expiration setting
- Debug logging setting

The plugin also writes share metadata to the published note's frontmatter so the note can be updated, copied, or stopped later.

## Server Storage And Encryption

DocFerry Cloud stores note body fields, object bytes, and sensitive share metadata using server-side encrypted-at-rest storage. New and updated shares encrypt `Share.markdown`, `Share.html_snapshot`, stored asset/object bytes, share title, source path, vault identifier, document identity, source hash, client metadata, asset filenames, asset original paths, asset hashes, and internal-link labels/targets with AES-GCM envelopes. The DocFerry server decrypts this data to render share pages, serve assets, verify imports, return import payloads, and show link status.

Historical rows created before metadata encryption may still contain legacy plaintext metadata until the operator runs the metadata backfill tool. The server keeps legacy read fallback so older shares can still be viewed, imported, stopped, and resolved during migration.

Fields that still need equality matching or deduplication use keyed blind indexes/HMAC indexes instead of plaintext values. This includes vault/document/path matching for internal links, link raw targets, share source hashes, and asset hashes. Blind indexes reduce plaintext exposure, but they can still reveal equality patterns to someone who has database access.

Some operational metadata remains plaintext because the service needs it to route, expire, stop, count, and serve shares:

- Owner/account ID
- Share ID and slug
- Status, stopped time, expiration time, and timestamps
- Content type, byte length, asset role, asset ID, and object storage key
- Active-share quota counts

DocFerry Cloud encrypted-at-rest storage is not end-to-end encryption and is not zero-knowledge hosting. The server has the configured encryption key and decrypts data when serving a share or import payload. DocFerry does not currently use per-share data encryption keys, KMS integration, or key rotation.

Passwords are not stored as plaintext. When password protection is enabled, the server stores a password hash.

DocFerry Cloud tokens are returned only to the plugin when issued and are stored locally in this vault's plugin data. The DocFerry Cloud server stores only HMAC-SHA256 token hashes. Replacement claims revoke the previous token for the same anonymous install ID and issue a new token.

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

- Connect DocFerry Cloud
- Test the server connection
- Publish or update a note
- Stop sharing a note
- Check linked-note status
- Import a share URL

To stop network use, clear the token, switch to an unreachable custom server URL, or disable the plugin.

## Diagnostics

Debug logging is off by default. When enabled, it writes limited publish diagnostics to the Obsidian developer console. Do not share console output publicly unless you have reviewed it for sensitive note names, file paths, or server details.
