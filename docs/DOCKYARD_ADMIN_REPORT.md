# Dockyard Admin and account provisioning

This report records the original rollout. The current [account provisioning flow](ARCHITECTURE.md) uses Super Admin-only creation inside a Dockyard.

## Authorization and user flows

| Actor | Account creation | Directory and membership |
| --- | --- | --- |
| Super Admin | May create a regular account and optionally assign any Dockyard | System directory and User management dashboard |
| Dockyard Admin | May create a regular account with membership in an active Dockyard they administer | Scoped search and Create user from Members |
| Manager, Viewer, other global roles and anonymous callers | Denied unless the signed-in user independently meets the Dockyard Admin or Super Admin rule | Existing Dockyard capabilities remain separate from provisioning |

The server saves the user, Better Auth credential, optional membership and audit event in one transaction. Passwords use Better Auth's existing hashing. Account creation rejects unknown privilege fields and case-insensitive duplicate emails. The scoped directory returns at most 20 IDs, names and email addresses. Existing separately guarded Super Admin role assignment remains available through its protected API operation.

Public Better Auth signup is disabled. Existing sessions, sign-in methods and the explicit offline Super Admin bootstrap are preserved. Last Admin protection still serializes removals and demotions on the Dockyard row.

The validation run also found a pre-existing signed URL edge case. Canonical signature comparison now rejects alternate Base64 encodings of identical signature bytes. Existing canonical links continue to work.

## Modified files

| Area | Paths |
| --- | --- |
| Schema and migration | `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/20261123090000_dockyard_admin_provisioning/migration.sql` |
| Better Auth | `packages/auth/src/server/auth.ts` |
| API authorization, provisioning and signed links | `apps/api/src/routes/admin/dockyard.ts`, `apps/api/src/routes/users/index.ts`, `apps/api/src/security/dockyard-policy.ts`, `apps/api/src/security/file-policy.ts`, `apps/api/src/services/dockyard-access.ts`, `apps/api/src/services/user-provisioning.ts` |
| Dashboard | `apps/web/app/dockyards/users/page.tsx`, `apps/web/app/vault-api/[...segments]/route.ts`, `apps/web/components/dockyard-detail.tsx`, `apps/web/components/members.tsx`, `apps/web/components/user-management.tsx`, `apps/web/components/user-provisioning.tsx`, `apps/web/components/workspace.tsx`, `apps/web/lib/dashboard-api.ts` |
| Validation | `apps/api/src/security.test.ts`, `apps/api/test/integration.test.ts`, `apps/web/e2e/acceptance.spec.ts`, `apps/web/e2e/helpers.ts`, `apps/web/next.config.js`, `apps/web/playwright.config.ts`, `turbo.json` |
| Documentation | `docs/API_INTEGRATION.md`, `docs/ARCHITECTURE.md`, `docs/CHECKPOINT_5_API_MAP.md`, `docs/DOCKYARD_ADMIN_MIGRATION.md`, `docs/DOCKYARD_ADMIN_REPORT.md`, `docs/SECURITY.md`, `docs/TESTING.md` |

See the [migration plan](DOCKYARD_ADMIN_MIGRATION.md) for deployment order, preflight and rollback.

## Validation against Docker PostgreSQL

The migration applied to the disposable host-test database `vaultfs_p1test_1117a`. Prisma reports all nine migrations applied. Native PostgreSQL was stopped when requested. The Docker Desktop engine returned to service after a restart, and the following verification used Docker PostgreSQL.

The rebuilt Docker release project migrated its own existing disposable database, `vaultfs_release_test`. Before migration it had seven Owner memberships and zero Dockyards with missing Owners or normalized email collisions. After migration it had seven Admin memberships and zero Owner memberships. The comparison matched the identity fingerprints for all seven membership assignments, seven Dockyards, three users, ten sessions, five API keys, and 29 file metadata rows. The API and web health checks passed after migration and explicit bootstrap.

| Check | Result |
| --- | --- |
| Typecheck, lint and API/web production builds | PASS |
| Docker API and web image rebuild and startup | PASS |
| Unit and white-box | PASS, 14 tests per command |
| Black-box and integration | PASS, 22 tests per command |
| Browser acceptance | PASS, 4 workflows including system and scoped account creation |
| Browser acceptance on rebuilt Docker images | PASS, 4 workflows |
| Usability | PASS, 1 responsive Chromium and axe workflow |
| Docker performance | PASS, 40 requests and zero errors. Upload p95 was 51.48 ms and download p95 was 36.83 ms. |
| Consolidated `pnpm test:all` | PASS, all seven categories |

The production-container browser harness retries once after an observed HTTP 429, waiting one Better Auth sign-in window. The application rate limit is unchanged.
