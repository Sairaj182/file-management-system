# VaultFS Phase 1 — Checkpoint 4 storage design proposal

## Repository compatibility review

The current schema already has `DockyardFile` with an existing Dockyard foreign key, opaque unique `storageKey`, display filename, content type, byte size, optional SHA-256, lifecycle state, timestamps, and nullable uploader. The existing `Api` model and API-key middleware already bind a key to one Dockyard and expose `READ`, `WRITE`, and `DELETE` capabilities. Dockyard session helpers expose view, upload, download, and delete policy checks. The Fastify app has multipart enabled at 10 MiB, and Compose currently has only a persistent PostgreSQL volume.

The design fits these existing boundaries. It keeps `Dockyards`, `Api`, `DockyardFile`, Better Auth, and PostgreSQL. File bytes stay on the filesystem. The schema needs one additive migration to add a `QUARANTINED` lifecycle value; it needs no new model, data rewrite, or destructive change. The previously issued API-key IDs/digests and Dockyard IDs remain untouched.

## Storage provider

Define a provider contract with `writeStream`, `readStream`, `delete`, `exists`, and optional `stat`. The local provider resolves an operator-configured root (`FILE_STORAGE_ROOT`) and maps a generated 256-bit opaque key into a fixed two-level object layout. Client filenames, Dockyard IDs, and request paths never form filesystem paths. A private `.staging` directory lives on the same volume as final objects so finalization uses an atomic rename. Writes use exclusive creation and restrictive file modes. Every key is format-validated; provider operations reject traversal and symlink targets. If the root is missing or unwritable, storage operations fail closed with `503 storage_unavailable`; the API can still start and report other health state.

Compose will mount a named `vaultfs_storage` volume at `/var/lib/vaultfs`, writable by the non-root API user. Development/test roots are configurable and tests use unique OS temporary directories, never the application volume.

## Upload and metadata lifecycle

1. Authenticate either a strict `X-API-Key` request with `WRITE` scope and exact Dockyard binding, or a Better Auth session with `canUploadFile` membership access. A supplied invalid API key never falls back to session auth.
2. Validate and normalize the display filename; generate a server-side opaque key; create a `STAGED` metadata row before writing bytes.
3. Stream each multipart file through a bounded counter, SHA-256 transform, and prefix inspector into a same-volume staging file. No full-file memory buffer is created.
4. Accept only the configured MVP allowlist (PNG, JPEG, WebP) after actual signature and filename-extension checks. Ignore client MIME for trust and store the canonical detected type. Unsupported, empty, malformed, truncated, or oversized content fails and staging data is removed where possible.
5. Persist size/checksum while the row is `STAGED`, atomically rename the staged object to its opaque final path, then mark the row `AVAILABLE`. If the process stops between steps, the row and deterministic stage/final key let an explicit reconciliation command complete or mark the upload failed.
6. Process multiple files independently. Successful files remain committed if another file fails. Return `201` when all succeed, `207` with per-file results for mixed/limit failures, and a client error when none can be accepted.

The current schema supports this sequence without file-specific columns. Add `QUARANTINED` for content that requires later inspection. Quarantined, staged, failed, deleting, and deleted rows are never downloadable. The MVP does not include a malware scanner and will not claim malware clearance; only signature/type checks run. Scanner integration, quarantine release controls, and operational review remain required before accepting broader untrusted formats.

## Read, delete, verify, and signed links

- List and metadata: API-key `READ` with Dockyard binding, or session plus `canViewDockyard`.
- Download and verify: API-key `READ`, or session plus `canDownloadFile`; only `AVAILABLE` objects are streamed. Responses use safe attachment names and `X-Content-Type-Options: nosniff`.
- Delete: API-key `DELETE`, or session plus `canDeleteFile`. Mark `DELETING`, remove the object, then mark `DELETED`; interrupted operations remain discoverable by reconciliation. Database rows are retained as tombstones.
- Verification recomputes SHA-256 from a stream and compares it with metadata. A mismatch fails closed and marks the object unavailable for download.
- Signed URL creation requires `READ`/download authorization. HMAC-SHA256 signs Dockyard ID, file ID, and expiry. TTL is explicit and capped by `SIGNED_URL_MAX_TTL_SECONDS`; the signing secret is separately configured and validated. The token contains no API key and no storage path. The anonymous download route still checks current file/Dockyard state in PostgreSQL. Deletion/quarantine therefore blocks later use; an already-started stream cannot be recalled. Signing tokens must be redacted from request logs.

## Audit and recovery

Write audit events for upload success/failure, download, delete, verification, signed-link creation, and authenticated authorization denials. Metadata contains file/key IDs, sizes, result codes, and checksum status only—never bytes, API-key secrets, signatures, or sensitive headers. Upload failures try to remove staging objects and retain a `FAILED` metadata/audit result. An explicit `pnpm storage:reconcile` command inspects `STAGED`/`DELETING` rows against the local provider and resolves interrupted finalization/deletion; it does not delete arbitrary files or operate on a production database without the configured environment.

## Routes proposed

All resource routes bind the URL Dockyard ID to the API key's Dockyard. Session requests use Dockyard membership helpers.

- `POST /api/dockyard/:dockyardId/files` — multipart single/multiple upload (`WRITE`).
- `GET /api/dockyard/:dockyardId/files` — paginated list (`READ`).
- `GET /api/dockyard/:dockyardId/files/:fileId` — metadata (`READ`).
- `GET /api/dockyard/:dockyardId/files/:fileId/download` — stream (`READ`).
- `DELETE /api/dockyard/:dockyardId/files/:fileId` — soft delete plus physical cleanup (`DELETE`).
- `POST /api/dockyard/:dockyardId/files/:fileId/verify` — SHA-256 verification (`READ`).
- `POST /api/dockyard/:dockyardId/files/:fileId/signed-url` — create short-lived signed download (`READ`).
- `GET /api/files/signed/:token` — consume an HMAC URL without an API key.

This proposal is compatible with the existing schema and route conventions. The only database change is additive enum extension; no existing rows or credentials need alteration. Implementation will use an isolated disposable PostgreSQL database and OS temporary storage for tests.
