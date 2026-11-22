# VaultFS Phase 1 — Checkpoint 3 Report

Date: 2026-11-18

## Status

Checkpoint 3 API-key lifecycle and external credential validation are implemented. File upload/download APIs and dashboard work remain out of scope and were not started.

## Schema and compatibility

- Reused the existing `Api` model, Dockyard ID, foreign key, and relationships.
- Added nullable unique `Api.keyPrefix` in migration `20261118120000_api_key_prefix`.
- Migration SQL only adds a nullable `TEXT` column and unique index. It does not rewrite, delete, or reassign existing rows or credentials.
- Existing rows without both a digest and prefix remain non-authenticating. They cannot be rotated; users create a new key instead.
- The migration was applied to the disposable database `vaultfs_p1test_1117a`; PostgreSQL reported all 7 migrations applied. The existing Dockyard foundation and user/auth tables were not changed by this migration.
- The stored digest is SHA-256 over a randomly generated 256-bit secret. Validation uses a constant-time byte comparison. Only the secret prefix and digest are stored; the raw key is returned once at create/rotate time.

## Credential and security policy

Credential format: `vfs_live_<16 lowercase hex prefix>_<43 base64url characters>`.

External scopes are `READ`, `WRITE`, and `DELETE`, mapped to `FILE_READ`, `FILE_WRITE`, and `FILE_DELETE`. Scopes are independent. A key is bound to one Dockyard and cannot be used for another. Authentication rejects unknown, malformed, invalid, expired, revoked, or inactive-Dockyard credentials. Route middleware can require scopes and bind the requested Dockyard ID. It never falls back to a Better Auth session when `X-API-Key` is supplied.

Rotation creates a replacement and revokes the previous key in one transaction, so the old secret stops working immediately after commit. In-flight requests that completed authentication before a concurrent revoke may finish; subsequent requests fail. Owner, Manager, or explicitly audited Super Admin can manage keys. Viewer and ordinary global Admin cannot.

Audit events contain key IDs, scopes, or rejection reason only. They omit secrets and digests. Invalid and known-key rejection logs also omit credential values. Integration and management endpoints use route rate limits; the integration probe keys limits by client IP so arbitrary invalid strings cannot evade the bucket.

## API endpoints

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/dockyard/:dockyardId/api-keys` | Create key, return raw secret once. |
| `GET` | `/api/dockyard/:dockyardId/api-keys` | List safe metadata. |
| `GET` | `/api/dockyard/:dockyardId/api-keys/:keyId` | Read safe metadata. |
| `POST` | `/api/dockyard/:dockyardId/api-keys/:keyId/rotate` | Immediately revoke old key and return replacement once. |
| `DELETE` | `/api/dockyard/:dockyardId/api-keys/:keyId` | Revoke key; `204` response. |
| `GET` | `/api/integration/me` | Validate `X-API-Key`; return safe key/Dockyard/scope/expiry metadata. |

All management endpoints require a Better Auth session. The integration probe uses API-key authentication only. Full request examples and response/error guidance are in `docs/API_INTEGRATION.md`.

## Files changed

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261118120000_api_key_prefix/migration.sql`
- `apps/api/src/security/api-key.ts`
- `apps/api/src/middleware/api-key-auth.ts`
- `apps/api/src/app.ts` (header redaction for API keys, authorization and cookies)
- `apps/api/src/services/api-keys.ts`
- `apps/api/src/routes/admin/api-keys.ts`
- `apps/api/src/routes/integration.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/security.test.ts`
- `apps/api/test/integration.test.ts`
- `docs/API_INTEGRATION.md`
- `docs/CHECKPOINT_3_REPORT.md`
- `docs/PHASE_1_REPORT.md`
- `docs/TESTING.md`
- `docs/audit/ARCHITECTURE.md`
- `docs/audit/FEATURE_MATRIX.md`
- `docs/audit/TASK_BACKLOG.md`

## Validation performed

All listed commands executed. Database-backed commands used only `.env.test.local` and the disposable test database.

| Command | Result |
|---|---|
| Prisma `generate` | Passed. |
| `pnpm check-types` | Passed; 7 workspace tasks. |
| `pnpm lint` | Passed; 4 workspace tasks. The existing RBAC package still reports two unused-import warnings. |
| `pnpm test` | Passed; 8 tests, 0 failures. |
| `pnpm test:whitebox` | Passed; 8 tests, 0 failures. |
| `pnpm test:blackbox` | Passed; 14 real HTTP tests, 0 failures. |
| `pnpm test:integration` | Passed; 14 real HTTP/PostgreSQL tests, 0 failures. |
| `pnpm build` | Passed; API and web build tasks successful. Turbo still warns that `api#build` has no output declaration. |
| Prisma `migrate deploy` with `.env.test.local` | Passed; additive prefix migration applied to `vaultfs_p1test_1117a`. |
| `git diff --check` | Passed. |

Integration coverage includes secure issuance/digest-only persistence/one-time disclosure, Owner and Manager access, Viewer and ordinary Admin denial, explicit Super Admin auditing, scope enforcement, route Dockyard binding, cookie fallback rejection, invalid/expired/revoked credentials, inactive Dockyard denial, immediate rotation and legacy-row behavior, secret-free audit metadata, and concurrent API-key use/revocation.

## Remaining risks

- Fastify route limits currently use the default process-local store. Configure a shared store and test its outage behavior before running multiple API replicas.
- Secret retrieval is intentionally impossible after creation or rotation; clients must securely capture the one-time response.
- Audit-event retention/immutability policy is not yet enforced at the database-role level.
- No file routes consume scopes in this checkpoint. File routes must call the reusable middleware with explicit scope and Dockyard-binding options.
- The prior deployment caveat remains: the local PostgreSQL container was exposed on host port 5434 with SSL disabled; production network policy is separate from this feature.

## Recommended Phase 1 work

Proceed to the next approved checkpoint for file storage/API workflows only after reviewing the storage-provider interface, streaming limits, atomic metadata lifecycle, malware/quarantine policy, and authorization matrix. Then integrate `requireApiKey` with explicit `READ`/`WRITE`/`DELETE` requirements and route Dockyard binding. Keep dashboard work behind stable file API contracts.
