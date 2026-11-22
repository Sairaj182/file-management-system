# VaultFS Phase 1 — Checkpoint 2 Report

Date: 2026-11-18

## Status

**Checkpoint 2 complete.** Dockyard membership, resource authorization, migration compatibility, and protected management routes are implemented and validated against the disposable PostgreSQL database. Upload/download handlers, API key issuance/validation, and dashboard work were not started.

The additive schema plan was recorded before implementation in [CHECKPOINT_2_PROPOSAL.md](CHECKPOINT_2_PROPOSAL.md).

## Schema changes

Migration: `20261118090000_dockyard_domain_foundation`.

- Preserved the existing `Dockyards` table, IDs, `createdById` ownership source, and current relationships. No `Warehouse` model/table was added.
- Added `DockyardMember` with a unique `(dockyardId, userId)` pair, resource roles `OWNER`, `MANAGER`, `VIEWER`, actor provenance, timestamps, lookup indexes, and restrictive Dockyard/user deletion policies.
- Backfilled each existing Dockyard creator as an initial Owner using an idempotent insert. New Dockyard creation now writes its Owner membership and creation audit event in the same transaction.
- Extended the existing `Api` model in place with optional name, unique nullable key digest, scope array, expiry, revocation, and last-use timestamps. Existing IDs and FKs were retained. Existing rows default to no scopes and have no key digest; no key issuance or authentication was added.
- Added `DockyardFile` metadata with an opaque unique storage key, name/content metadata, byte size, SHA-256 field, lifecycle state, and optional uploader. It stores no binary data and has no upload/download route.
- Added `DockyardAuditEvent` with Dockyard, actor/target user references, action, metadata and time. User deletion preserves events by nulling actor/target references; Dockyard deletion is restricted.
- Added enums for membership roles, future API-key scopes, and file lifecycle states. Existing Dockyards and authentication tables were not renamed or deleted.

## API routes

Every route requires a Better Auth session. Unauthorized and non-member Dockyard access returns `404` to reduce resource-existence disclosure.

| Method | Route | Behavior / authorization |
|---|---|---|
| `GET` | `/api/dockyard` | Lists only accessible Dockyards. Super Admin sees all with one audit event per listed Dockyard. |
| `GET` | `/api/dockyard/active` | Accessible Dockyards with ACTIVE status. |
| `GET` | `/api/dockyard/inactive` | Accessible Dockyards with INACTIVE status. |
| `GET` | `/api/dockyard/incustody` | Accessible Dockyards with INCUSTODY status. |
| `GET` | `/api/dockyard/suspended` | Accessible Dockyards with SUSPENDED status. |
| `GET` | `/api/dockyard/:dockyardId` | Member access; Super Admin access is audited. |
| `POST` | `/api/dockyard` | Requires global `dockyard:create:any`; creates an ACTIVE Dockyard, initial Owner membership, and audit event transactionally. Body: `{ "notes": "..." }`. |
| `GET` | `/api/dockyard/:dockyardId/members` | Owner or Super Admin; returns member identity and role fields. |
| `POST` | `/api/dockyard/:dockyardId/members` | Owner or Super Admin. Body: `{ "userId": "...", "role": "OWNER|MANAGER|VIEWER" }`. |
| `PATCH` | `/api/dockyard/:dockyardId/members/:userId` | Owner or Super Admin. Body: `{ "role": "OWNER|MANAGER|VIEWER" }`. |
| `DELETE` | `/api/dockyard/:dockyardId/members/:userId` | Owner or Super Admin; returns `409` if removal would leave no Owner. |

Duplicate membership returns `409`; invalid bodies return `400`; inaccessible Dockyards/members return `404`.

## Authorization rules

| Resource role | View Dockyard | Membership changes | Upload future files | Download future files | Delete future files | Manage future API keys |
|---|---:|---:|---:|---:|---:|---:|
| Owner | Yes | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | No | Yes | Yes | Yes | Yes |
| Viewer | Yes | No | No | Yes | No | No |

- Resource roles are stored on `DockyardMember` and remain distinct from global roles.
- Membership APIs require the Owner resource role. Manager cannot change membership; Viewer cannot manage membership.
- Global Admin does not imply Dockyard access. A global Admin without membership receives the same denial as another non-member.
- Super Admin can explicitly access any Dockyard. Each such list/detail/membership operation writes a `SUPER_ADMIN_DOCKYARD_*` audit event. Super Admin creation is also marked explicitly in its creation audit event.
- Authorization helpers (`canViewDockyard`, `canManageDockyard`, `canUploadFile`, `canDownloadFile`, `canDeleteFile`, and `canManageApiKeys`) deny when the Dockyard or membership is absent and evaluate the actor, Dockyard and requested action.
- Owner mutations lock the parent Dockyard row and recheck ownership in the same transaction. Demoting or removing an Owner is rejected if it leaves no Owner. Concurrent requests are serialized per Dockyard.

## Tests and validation

The test database is `vaultfs_p1test_1117a` in the local `fms-postgres` PostgreSQL 16 container. The migration was applied only there.

| Command / check | Result |
|---|---|
| Prisma Client generation | Passed. |
| `prisma migrate deploy` using `.env.test.local` | Passed; Checkpoint 2 migration applied. |
| Read-only Prisma `migrate diff` from database to schema | Passed; empty migration (no drift). |
| Migration ID comparison | Passed; both pre-existing Dockyard IDs remained unchanged. There were 0 pre-existing `Api` rows in this database. |
| `pnpm check-types` | Passed; 7 workspace tasks successful. |
| `pnpm lint` | Passed; two existing unused-type warnings remain in RBAC. |
| `pnpm test` | Passed; 6 tests, 0 failures. |
| `pnpm test:whitebox` | Passed; 6 tests, 0 failures. |
| `pnpm test:blackbox` | Passed; 8 real HTTP/database tests, 0 failures. |
| `pnpm test:integration` | Passed; 8 real HTTP/database tests, 0 failures. |
| `pnpm build` | Passed; API and Next.js production builds successful. Turbo still warns that the API build has no declared output files. |

The eight integration tests cover Better Auth login/logout/expiry; admin-created login and password reset; legacy credential issuer migration; global role protections; initial Dockyard creation authorization; preservation/owner invariants; member administration, resource isolation, Admin denial and Super Admin audit; and concurrent owner removal.

## Existing-data compatibility

- Before migration, the disposable test database contained 2 Dockyards and 0 Api rows. Both Dockyard IDs were compared before and after migration and remained unchanged.
- The migration creates an Owner membership for each legacy Dockyard creator without changing the existing Dockyard row or creator reference.
- Final read-only check found 6 successful migrations, 26 Dockyards, 0 Api rows, and 0 Dockyards without an Owner. Repeated integration runs create unique fixture records and do not clean them up; this database is disposable and was not dropped or reset.
- The existing `Api` table and its Dockyard/creator FKs remain in place. There were no Api rows in this test database, so row-by-row preservation of a pre-existing Api fixture was not observable here.
- Better Auth user/account/session models were not modified in this checkpoint. No dev or production database was used.
- Nullable `Api.keyDigest` and empty `scopes` intentionally leave existing Api records non-authenticating until a future key-issuance checkpoint.

## Remaining issues and risks

- The last-owner invariant is enforced by the API transaction service. Direct SQL or future code that mutates `DockyardMember` without locking the parent `Dockyards` row can bypass it; maintain the shared transaction convention or add database-level enforcement before opening direct mutation paths.
- Audit records are written transactionally for the implemented Dockyard operations, but append-only database privileges/retention and broader auth, key, and file event coverage are not implemented.
- Manager file/key capabilities are authorization foundations only; no file or API-key handlers exist yet.
- The existing API model has no key issuance behavior, raw API secrets are never created or stored by this checkpoint.
- Existing lint warnings in two RBAC repositories and Turbo's API build-output warning remain.
- The existing local PostgreSQL container publishes port 5434 on all host interfaces and has SSL disabled. No container configuration was changed; use host firewall rules to restrict clients.

## Recommended next checkpoint

Proceed only after reviewing this migration and authorization policy. The next relevant work is API-key lifecycle/authentication and storage-provider design, followed by upload/download routes that call the resource authorization helpers. Do not expose file operations until storage safety, malware/content policy, and the corresponding integration tests are implemented.
