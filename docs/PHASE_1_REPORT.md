# VaultFS Phase 1 — Checkpoint 1 Report

Date: 2026-11-17

## Status

**Checkpoint 1 complete.** This report records the initial auth/database gate. Checkpoint 2 has since added the Dockyard membership and authorization foundation; see [docs/CHECKPOINT_2_REPORT.md](CHECKPOINT_2_REPORT.md). Storage, uploads/downloads, API key issuance, and dashboard implementation remain out of scope.

## Test environment

- Docker Engine 29.8.0 was running; container `fms-postgres` reported `healthy` and exposed PostgreSQL on host port `5434`.
- PostgreSQL reported version `16.15`.
- PostgreSQL listens on container port `5432` (`listen_addresses = '*'`, `max_connections = 100`, `ssl = off`); the integration client successfully connected through host `127.0.0.1:5434` using the test-only database role.
- Created a separate disposable role and database, `vaultfs_p1test_1117a`; its owner and login role are the same test-only account. Existing `fms` and `postgres` databases were left untouched.
- Created ignored `.env.test.local` with a random database password, Better Auth/JWT secrets, test URLs, and placeholder-only credentials for unused external integrations. No production or development credential was changed or added to Git.
- Applied the repository migrations to the disposable database; all five migrations completed, including the credential issuer compatibility backfill. The test-only Super Admin and system roles were bootstrapped there.

## Changes implemented

- Added `pnpm test:integration` and a non-cacheable Turborepo task for the API integration suite.
- Added real-PostgreSQL, real-HTTP tests for Better Auth sessions, admin-created credentials, password reset, legacy credential compatibility, role protection, and Dockyard authorization/validation.
- Fixed admin-created and reset credential accounts to include Better Auth's current `local:credential` issuer.
- Added an additive, idempotent migration that fills the issuer only on existing credential accounts where it is null. This addresses login failures after the installed Better Auth upgrade while retaining account IDs, hashes, and relationships.
- No Dockyard schema or API behavior was extended during this checkpoint.

## Commands executed and results

The following package-manager commands were run with the repository-pinned pnpm 9.0.0 available from the local Corepack cache:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; lockfile remained frozen and Prisma Client generation completed. |
| `pnpm check-types` | Passed; 7 workspace tasks successful. |
| `pnpm lint` | Passed; 4 workspace lint tasks successful. RBAC reports 2 existing unused-type warnings. |
| `pnpm test` | Passed; 5 tests, 0 failures. |
| `pnpm build` | Passed; API and Next.js production builds successful. Turbo reports the existing API build output declaration warning. |
| `pnpm test:integration` | Passed; 5 tests, 0 failures, using the disposable PostgreSQL database and actual Fastify/Better Auth routes. |
| Prisma `migrate deploy` with `.env.test.local` | Passed; 5 migrations applied to the disposable database. |
| PostgreSQL migration ledger query | Passed; confirmed 5 completed migrations in `vaultfs_p1test_1117a`. |
| `docker compose --env-file .env.example config --quiet` | Passed in the prior Phase 0 validation. |
| `git diff --check` | Passed. |

The integration tests verified:

1. Better Auth email login and an authenticated `/api/users/me` request.
2. Logout invalidates the session.
3. An expired persisted session is rejected.
4. An admin-created user can log in through Better Auth.
5. Admin password reset accepts the new password, rejects the old password, and invalidates the user's prior session.
6. System-role assignment through the ordinary role endpoint is rejected, including for Super Admin; a non-admin cannot assign roles through either role assignment or `roleIds` update.
7. A normal account without the create permission cannot create a Dockyard.
8. An authorized account can create an ACTIVE Dockyard and is recorded as its creator.
9. Invalid Dockyard notes are rejected.
10. A synthetic legacy credential with a null issuer is backfilled using the checked-in migration and then logs in successfully.

## Security and data integrity

- The only database writes were to the newly created disposable database. No existing user records, development database, or production database were modified.
- The compatibility migration is additive and updates only `account` rows with `providerId = 'credential'` and a null `issuer`.
- The test secrets and database password are held in the ignored local `.env.test.local`; they were not printed in command output or written into tracked files.
- Test-only placeholder Google, Gemini, and AWS values are not usable credentials.

## Remaining problems

- Lint still reports two unused `PermissionDefinition` imports in RBAC repositories.
- Turbo warns that `api#build` has no output files declared in `turbo.json`; the build itself succeeds.
- The existing PostgreSQL container publishes `5434` on all host interfaces while PostgreSQL SSL is off. This was not changed; host firewall/network policy must restrict access to trusted clients.
- Admin reset uses the same Better Auth password hasher and credential issuer as Better Auth login. Email recovery delivery and external Google OAuth were not part of this checkpoint's integration coverage.
- The repository's future white-box, black-box, acceptance, usability, and performance test categories are not implemented by this checkpoint.
- Container image build was not rerun; host production builds and the prior Compose configuration validation passed.

## Compatibility and migration risk

Deploy the new migration before application code that relies on Better Auth's issuer-qualified credential lookup. The migration only fills null issuer values and is safe to reapply, but it should still be reviewed through the normal deployment process. The existing `account.issuer` column remains nullable for compatibility with other account providers.

The test database and `.env.test.local` are local disposable resources. They can be retained for reruns or removed manually after review; no cleanup operation was run.

## Recommended next work

Proceed to the next approved Phase 1 checkpoint only after reviewing the migration and this report. Do not start Dockyard extensions, file storage, API keys, or dashboard work as part of Checkpoint 1.

---

# Phase 1 Checkpoint 3 update

Date: 2026-11-18

Checkpoint 3 implements Dockyard-scoped API-key issuance, listing, inspection, rotation, revocation, strict `X-API-Key` middleware, and `GET /api/integration/me`. It uses the existing `Api` model with a nullable unique key prefix migration; old rows without credentials remain non-authenticating. Secrets are random, digest-only at rest, returned once, and omitted from logs and audit metadata. Rotation revokes the old key immediately in the same transaction as replacement creation. Owners and Managers can manage keys; Viewer and ordinary global Admin are denied; Super Admin access is audited.

Commands executed for Checkpoint 3: `pnpm check-types` (passed, 7 workspace tasks), `pnpm lint` (passed, 4 workspace tasks; two existing RBAC unused-import warnings), `pnpm test` (8 passed), `pnpm test:whitebox` (8 passed), `pnpm test:blackbox` (14 passed), `pnpm test:integration` (14 passed against disposable PostgreSQL), and `pnpm build` (API and web passed; existing Turbo output declaration warning). Prisma Client generation and migration `20261118120000_api_key_prefix` also passed against `vaultfs_p1test_1117a`. See [`docs/CHECKPOINT_3_REPORT.md`](CHECKPOINT_3_REPORT.md) for endpoint details, files changed, compatibility, test coverage, and remaining risks.

---

# Phase 1 Checkpoint 4 update

Checkpoint 4 source implementation adds a streaming local filesystem provider, multipart file APIs, file lifecycle and checksum verification, short-lived HMAC signed downloads, quarantine state, explicit reconciliation, and a CLI smoke flow. It preserves the existing Dockyard IDs, API credentials, and `DockyardFile` metadata model; the only schema change is additive migration `20261122120000_file_storage_quarantine`. The default accepted types are PNG/JPEG/WebP, with 10 MiB/file and five files/request defaults. No malware scanner is integrated.

**Checkpoint 4 is complete.** The additive migration was applied to disposable PostgreSQL database `vaultfs_p1test_1117a`; all 20 integration tests and all 20 black-box HTTP tests pass. The API Docker image builds successfully. Database-backed runs found and fixed truncated multipart acceptance and signed-token route parameter length handling. See [`docs/CHECKPOINT_4_REPORT.md`](CHECKPOINT_4_REPORT.md) for routes, storage policy, commands, and remaining production risks. Dashboard work remains out of scope.

---

# Phase 1 Checkpoint 5 update

The Next.js dashboard now connects Better Auth sessions to Dockyards, member management, file operations, scoped API keys and project onboarding. It uses the existing Fastify contracts with an additive caller-role field on Dockyard details. No database migration was required.

**Checkpoint 5 is complete.** All three Playwright acceptance workflows and the usability suite passed against real services and disposable PostgreSQL. Results, desktop and mobile screenshots, and deployment settings are recorded in the [Checkpoint 5 report](CHECKPOINT_5_REPORT.md).
