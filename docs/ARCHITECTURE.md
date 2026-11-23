# VaultFS architecture

## Dashboard

The Next.js dashboard lives at `/dockyards`. Its server layout checks the
Better Auth cookie through `GET /api/users/me`. Dashboard requests go through
the same-origin `/vault-api` route handler, which forwards a fixed set of
Fastify paths and streams uploads and downloads. Fastify remains the authority
for authentication, permissions and data. The handler rejects writes from
origins other than `WEB_ORIGIN` and prevents caching of upstream responses.

Configure `API_URL` as the internal Fastify base ending in `/api`,
`NEXT_PUBLIC_API_URL` as the external integration API base, and `WEB_ORIGIN`
as the public dashboard origin. Add the dashboard origin to Fastify's
`CORS_ORIGIN` so Better Auth trusts it. Keep host-only cookies or configure
`COOKIE_DOMAIN` to cover the dashboard and the public Better Auth host.
Set matching file size, count and signed-link TTL settings for both services.

Dockyard details include `memberRole` for the caller. The dashboard uses
that role and the existing global permissions to decide which controls to
show. API key secrets exist in the disclosure dialog until it closes.

## Core domains

VaultFS uses **Dockyard** for an isolated logical storage warehouse. `DockyardMember` assigns `ADMIN`, `MANAGER`, or `VIEWER` within one Dockyard. The global role named Super Admin is the system administrator. The existing global Admin and User roles remain for RBAC compatibility. Dockyard Admin authority comes from membership in the target Dockyard. Explicit Super Admin access is audited.

A Super Admin opens a Dockyard and selects **Members → Add User**. The form takes a login ID (email), an initial password with confirmation, and a Dockyard role. The account, Better Auth credential, membership, and audit entry are written in one transaction. Dockyard Admins can change or remove existing memberships in their own Dockyards. Those changes lock the Dockyard and protect the last Admin from removal or demotion.

The existing `PUT /api/users/:id` operation guards global `roleIds` changes with a separate Super Admin check. The provisioning form and endpoint accept no global roles. Public Better Auth signup is disabled. See the [Dockyard Admin migration plan](DOCKYARD_ADMIN_MIGRATION.md).

Better Auth remains the primary session authority. External server applications use Dockyard-bound API keys with stored digests and independent READ, WRITE, and DELETE scopes. A supplied invalid API key fails closed and is never replaced by session-cookie authentication.

## File data and storage

`DockyardFile` stores metadata, a unique opaque storage key, SHA-256, byte count, content type, uploader, and lifecycle state in PostgreSQL. It does not store file bytes. Migration `20261122120000_file_storage_quarantine` additively adds `QUARANTINED`; existing Dockyard, API-key, and file identifiers are preserved.

The `StorageProvider` contract exposes streaming writes/reads, delete, existence, stat, and recovery helpers. The MVP local provider stores objects under `FILE_STORAGE_ROOT/objects/<first-two-key-characters>/<opaque-key>` and interrupted writes under `.staging`. Client filenames and Dockyard identifiers never become paths. Files are created exclusively with restrictive permissions, streamed through a byte bound and SHA-256 transform, validated, and atomically renamed on the same filesystem before becoming AVAILABLE. Docker Compose mounts persistent `vaultfs_storage` at `/var/lib/vaultfs`; API runs as an unprivileged user.

Allowed uploads are PNG, JPEG, and WebP with filename extension and byte signature agreement, followed by Sharp decoding with a 12-megapixel pixel limit. Default limits are 10 MiB/file and five files/request (environment-configurable within bounds). Client MIME is ignored. There is no malware scanner; this is format validation, not a malware-clearance claim. Unsupported or malformed input is rejected. QUARANTINED files are not downloadable.

## Lifecycle and consistency

Upload writes a STAGED metadata row and staging object, persists size/checksum, atomically finalizes the object, then marks the row AVAILABLE with an audit event. Failures clean up bytes where possible and mark FAILED. Delete records DELETING before removing bytes and then leaves a DELETED metadata tombstone. `pnpm storage:reconcile` repairs STAGED/DELETING rows and removes orphan staging files; it verifies size and checksum before recovering an upload. Run reconciliation explicitly and monitor its result; it is not an API startup action.

All API-key routes bind the requested Dockyard to the key's Dockyard. Session routes use the existing Dockyard capability helpers. Downloads and verification require AVAILABLE state. Signed download tokens use HMAC-SHA256 over file, Dockyard, and expiry, with TTL capped at one hour (default five minutes). The URL has no API key or storage path. Current state is checked on each use, so deleted/quarantined resources are denied. Already-started streams cannot be recalled; signed links cannot be individually revoked before expiry.

## Audit, limits, deployment

Audits capture upload/download/delete/verify/signed-link and authorization outcomes without content, credentials, or sensitive headers. Signed URL tokens are redacted from request logs. Rate limits are in-process and per route/client; multi-replica deployments need a shared limiter before broad public use.

Set `FILE_STORAGE_ROOT`, `FILE_SIGNING_SECRET` (at least 32 characters, independently generated), `FILE_PUBLIC_BASE_URL`, `FILE_SIGNED_URL_MAX_TTL_SECONDS`, `FILE_MAX_SIZE_BYTES`, and `FILE_MAX_COUNT`. Back up filesystem objects and PostgreSQL metadata consistently; restoring one without the other may require reconciliation and operational recovery. Apply database migrations explicitly before deploying the new API image. Compose's named storage volume persists across container replacement.
