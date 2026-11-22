# VaultFS Phase 1 — Checkpoint 4 Report

Date: 2026-11-22

## Status

**Checkpoint 4 complete.** The additive migration was applied to disposable database `vaultfs_p1test_1117a`; migration status is clean, and real PostgreSQL integration and black-box HTTP suites pass.

## Storage design and compatibility

The reviewed proposal is [CHECKPOINT_4_PROPOSAL.md](CHECKPOINT_4_PROPOSAL.md). It retains the existing `Dockyards`, `Api`, and `DockyardFile` models and IDs, stores bytes outside PostgreSQL, and adds only `QUARANTINED` to `FileLifecycleState` through migration `20261122120000_file_storage_quarantine`. No existing record or credential was deleted or rewritten. Migration status reports all eight repository migrations applied to the disposable test database.

The provider stores opaque keys in local `objects/<prefix>/<key>` paths with a same-volume `.staging` directory, bounded stream writes, SHA-256, exclusive creation, symlink checks, restrictive permissions, and atomic rename. Compose persists `/var/lib/vaultfs` through `vaultfs_storage`. Uploads allow PNG/JPEG/WebP after extension, byte signature, and Sharp decoder checks (12 MP limit); default limits are 10 MiB per file and 5 files per request. Client MIME is not trusted. No malware scanner is integrated; this must not be described as malware scanning.

## Routes

- `POST /api/dockyard/{dockyardId}/files` — multipart upload; `WRITE` or session upload permission. Each file result is independent; mixed outcomes return `207`.
- `GET /api/dockyard/{dockyardId}/files?page=&limit=` — paginated list; `READ` or view permission.
- `GET /api/dockyard/{dockyardId}/files/{fileId}` — metadata.
- `GET /api/dockyard/{dockyardId}/files/{fileId}/download` — AVAILABLE file stream.
- `POST /api/dockyard/{dockyardId}/files/{fileId}/verify` — streamed SHA-256 and size check; mismatch quarantines.
- `POST /api/dockyard/{dockyardId}/files/{fileId}/signed-url` — issue capped short-lived HMAC link.
- `DELETE /api/dockyard/{dockyardId}/files/{fileId}` — `DELETE` scope or session delete permission, retaining metadata tombstone.
- `GET /api/files/signed/{token}` — signed download; state and active Dockyard checked on each use.

Every API-key operation enforces key-to-Dockyard binding and relevant scopes. Invalid keys do not fall back to Better Auth sessions. Session operations use Dockyard membership helpers. Signed URLs contain no API key or storage path. Deletion/quarantine block future link use, but an existing download stream cannot be recalled.

## Files changed

Implementation touches API environment validation, multipart limits, Fastify logging, route registration, file routes and service, content/signed-token policy, local provider, reconciliation and smoke scripts, Docker image/Compose storage volume, `.env.example`, `.gitignore`, Prisma schema/migration, security and PostgreSQL HTTP integration tests, API integration/testing/architecture documentation, and this report.

The API Docker entry point now matches the CJS artifact emitted by `tsup`. The integration test fixture uses Node's `node:crypto` APIs explicitly rather than relying on a Web Crypto global.

Runtime tests found two implementation issues and they are fixed: Fastify now accepts the bounded signed-token parameter length through `routerOptions`, and uploads reject multipart streams marked `truncated` before finalization. The first container build also exposed Prisma's install hook running before the schema was copied; the Docker installer layer now includes Prisma schema/config before frozen installation.

## Validation actually executed

| Command/check | Result |
|---|---|
| `pnpm check-types` | Passed; 7 workspace tasks successful after final code edits. |
| `pnpm lint` | Passed; 4 tasks successful. Two existing unused-import warnings remain in RBAC, whose lint command allows warnings. |
| `pnpm test` | Passed; 12 tests, 0 failures. |
| `pnpm test:whitebox` | Passed; 12 tests, 0 failures. |
| `pnpm build` | Passed; API and web production builds. Existing Turbo warning says `api#build` has no declared outputs. |
| `pnpm --filter @repo/database exec prisma validate` | Passed; Prisma schema valid. |
| `pnpm exec dotenv -e .env.example -- docker compose config --quiet` | Passed; Compose configuration parses. |
| `pnpm test:blackbox` | Passed; 20 tests, 0 failures. Covers real HTTP auth, role, key, Dockyard, file, signed-link, and concurrency cases. |
| `pnpm test:integration` | Passed; 20 tests, 0 failures against real PostgreSQL and HTTP flows, including file upload, partial failures, quarantine, reconciliation, database write failure, and concurrent deletion. |
| `pnpm exec dotenv -e .env.test.local -- pnpm db:migrate:deploy` | Passed; applied only `20261122120000_file_storage_quarantine` to `vaultfs_p1test_1117a`. |
| `pnpm exec dotenv -e .env.test.local -- pnpm db:status` | Passed; all 8 migrations applied, schema up to date. |
| `docker compose --env-file .env.example build api` | Passed; API image built, including Prisma generation and `dist/index.cjs` runtime artifact. |

The complete validation commands have been run:

```powershell
pnpm check-types
pnpm lint
pnpm test
pnpm test:whitebox
pnpm test:blackbox
pnpm test:integration
pnpm build
pnpm exec dotenv -e .env.test.local -- pnpm db:migrate:deploy
docker compose --env-file .env.example config --quiet
```

The integration harness asserts that `DATABASE_URL` names only `vaultfs_p1test_1117a`, uses OS temporary storage, and removes only its verified temporary directory. Tests created fixtures in that disposable database; development and production databases were not used.

## Remaining risks and recommended next work

- Start the built API image under the target deployment profile and verify persistent volume ownership and environment values at runtime; image build and Compose syntax passed, but the API container was not started.
- Local filesystem storage is single-host and does not support multi-replica shared storage. Backups must include both metadata and object volume.
- In-process rate limits are not shared between replicas. Malware scanning is not present. Signed links are bearer credentials until TTL expiry.
- Review reconciliation operational output and schedule it through deployment operations if needed; no automatic scheduler is introduced.

No Phase 1 dashboard work, file binaries in PostgreSQL, destructive migrations, production database changes, commits, or pushes were performed.
