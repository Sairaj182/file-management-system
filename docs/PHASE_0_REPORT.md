# Phase 0 Report — Stabilization and Domain Alignment

Date: 2026-11-17

## Changes implemented

- Removed cookie/header and raw error data from session/auth logs. Session failures now emit a fixed event; Better Auth handler and set-password failures use redacted messages.
- Reduced `/api/health` to `{ status: "ok" | "degraded" }`; database driver errors and configuration are not returned.
- Disabled forwarded-header trust by default in Fastify and Better Auth. Fastify accepts `TRUST_PROXY=false` or an explicit proxy IP/CIDR allowlist. Better Auth proxy trust remains disabled. Cookies are host-only by default; optional `COOKIE_DOMAIN` enables explicit sharing, and `HttpOnly`, `SameSite=Lax`, and HTTPS-derived `Secure` are set.
- Protected system roles: ordinary role grant/removal endpoints cannot change system roles; role assignment through user updates requires a Super Admin and validates all requested role IDs. The role replacement is transactional. The `Super Admin` name is reserved in role creation and updates.
- Normalized recovery phone inputs to valid Indian E.164 numbers, made public check/cooldown responses enumeration-neutral, added route IP limits, and changed recovery count updates to atomic increments.
- Completed the Dockyard create route. It accepts trimmed notes, generates its ID, creates an ACTIVE row, records the authenticated creator, and requires `DockyardPermissions.CREATE_ANY`.
- Kept Better Auth as the session authority. Admin-created and reset credentials now use Better Auth's password hash helper. Removed the known fallback bootstrap password and stopped logging Super Admin credentials.
- Removed migration and seed execution from Compose API startup. Added explicit `db:migrate:deploy` and `db:bootstrap` commands. Pinned pnpm/Turbo versions in the API image and enabled frozen-lockfile installs.
- Added workspace test/typecheck scripts, an API Node test-runner suite, and a GitHub Actions validation workflow.
- Completed validation after locating pnpm 9.0.0 in the Corepack cache; aligned workspace typings and scripts exposed by the first real typecheck/lint runs.
- Documented Dockyard = Warehouse in requirements and architecture. Existing `Dockyards` model, IDs, and relations remain the Warehouse identity; Phase 0 adds no schema change or duplicate model.

## Files changed

- Runtime/security: `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/security/policies.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/routes/recovery.ts`, `apps/api/src/routes/auth/better-auth.ts`, `apps/api/src/routes/auth/custom.ts`, `apps/api/src/routes/roles/index.ts`, `apps/api/src/routes/users/index.ts`, `apps/api/src/routes/admin/dockyard.ts`, `apps/api/src/routes/admin/dockyard-schema.ts`, `apps/api/src/utils/phone.ts`.
- Tooling/deployment: root `package.json`, `pnpm-lock.yaml`, `turbo.json`, `apps/api/package.json`, `apps/api/eslint.config.js`, `packages/auth/package.json`, `packages/auth/tsconfig.json`, `packages/database/package.json`, `packages/database/prisma.config.ts`, `packages/env/package.json`, `packages/rbac/package.json`, `packages/rbac/eslint.config.js`, `apps/api/Dockerfile`, `compose.yml`, `.env.example`, `.github/workflows/ci.yml`.
- Bootstrap: `packages/auth/src/server/auth.ts`, `packages/database/prisma/seed/super-admin.ts`.
- Documentation: `docs/PROJECT_REQUIREMENTS.md`, `docs/audit/ARCHITECTURE.md`, `docs/audit/FEATURE_MATRIX.md`, `docs/audit/DEVELOPMENT_ROADMAP.md`, `docs/audit/TASK_BACKLOG.md`, `docs/audit/OPEN_QUESTIONS.md`, `docs/PHASE_0_REPORT.md`.
- `.gitignore` already had a pre-existing `docs/` ignore change. I preserved it and added exceptions so the requested Markdown documentation is visible to Git.

## Security issues resolved

- **ST-01:** Credential-bearing headers and raw auth errors are no longer logged by the session/auth paths.
- **ST-02:** Public health output no longer includes configuration, hosts, database URLs, secret fragments, or driver errors.
- **ST-03:** Proxy trust and cross-subdomain cookie sharing now require explicit configuration; secure cookie attributes are defined.
- **ST-07:** System-role assignment paths now enforce Super Admin authority, and ordinary role grants reject system roles.
- **ST-08:** Public phone lookup/cooldown responses no longer disclose account/cooldown state; inputs are normalized and rate-limited.

## Validation run and results

- Corepack pnpm 9.0.0 from local cache plus `pnpm install --frozen-lockfile` — passed. Offline install was incomplete; the approved network-enabled frozen install completed. The lockfile was unchanged by install.
- Prisma Client generation from database package `postinstall` — passed (Prisma 7.9.1).
- `pnpm check-types` — passed after adding `@types/pg`, enabling dependency declaration skipping for Better Auth's optional Bun/Cloudflare declarations, and constraining Fastify proxy configuration to supported IP/CIDR values.
- `pnpm lint` — passed. RBAC emitted two existing unused-import warnings; no lint errors.
- `pnpm test` — passed, 5 API security regression tests, 0 failures.
- `pnpm build` — passed with elevated workspace permission for Next standalone symlink tracing. The sandboxed attempt failed with Windows `EPERM` while creating standalone symlinks.
- `git diff --check` — passed.
- `docker compose --env-file .env.example config --quiet` — passed.
- Compose rendered with `.env.example`; API command contains no migration or seed invocation, and proxy/cookie settings are passed through.
- Better Auth/PostgreSQL credential, session-expiry, reset, legacy-issuer, and role integration checks were completed in Phase 1 Checkpoint 1 against a separate disposable PostgreSQL 16 database. See `docs/PHASE_1_REPORT.md` for commands, test counts, and results.
- Phase 0 itself added no Prisma migration or seed operation. Checkpoint 1 later applied an additive null-only account issuer backfill migration and test-only roles/admin to its disposable database; no existing development or production database was targeted.

## Remaining problems

- Better Auth login/logout, expiry, admin-created credentials, reset, legacy credential compatibility, and role enforcement passed against disposable PostgreSQL in Phase 1 Checkpoint 1. Recovery throttling has not had equivalent database-backed integration coverage.
- OTP send cooldown still uses a read-then-send flow in the Better Auth plugin and needs an atomic/shared limiter review. The new public recovery route limits are process-local under the current Fastify configuration, so they do not provide cross-replica abuse control.
- The public recovery cooldown endpoint preserves its legacy response shape but now always returns inactive; clients that relied on real remaining-time details need an API update.
- The Dockyard POST body changes from the unusable `id` placeholder to `{ notes }`. Existing Dockyard rows are untouched, and IDs are now generated by Prisma.
- Existing Compose deployments must set `TRUST_PROXY` to the exact IP/CIDR allowlist only when behind known proxies. Set `COOKIE_DOMAIN` only when sibling subdomains require shared cookies. No current deployment topology was available to validate those values.
- Container image build remains unverified; host production builds and Compose configuration validation passed. See `docs/PHASE_1_REPORT.md` for current checkpoint validation.
- Container image build remains unverified; only Docker Compose configuration was parsed.

## Migration and compatibility risks

- Phase 0 added no Prisma schema migration. Phase 1 Checkpoint 1 added a data-preserving issuer backfill migration for existing Better Auth credential accounts; it fills only rows where `providerId = 'credential'` and `issuer IS NULL`.
- Deployments should run `pnpm db:migrate:deploy` as a release step and `pnpm db:bootstrap` only when intentionally provisioning initial system data. Creating a new Super Admin now requires a non-empty `SUPER_ADMIN_PASSWORD`.
- Prisma install-time client generation uses a localhost-only placeholder URL when `DATABASE_URL` is absent; database commands use the explicit environment-loaded `DATABASE_URL`.
- Lockfile importer changes align root/RBAC ESLint with the already locked ESLint 9 package and add the already locked `@types/pg`; the frozen install validated successfully.

## Recommended Phase 1 tasks

1. Define Dockyard/Warehouse ownership and membership policy before introducing scoped file access.
2. Extend the existing Dockyards identity additively with membership, file metadata, API-key digest/scope, and audit models; do not create a parallel Warehouse table.
3. Add disposable-PostgreSQL integration coverage for recovery throttling and OTP behavior; login/logout, session expiry, admin create/reset, legacy credential compatibility, role escalation denials, and Dockyard creation are covered by Phase 1 Checkpoint 1.
4. Replace process-local throttling with an explicitly selected shared limiter design and make OTP cooldown acquisition atomic.
5. Define the StorageProvider and file lifecycle/authorization contracts before implementing uploads.
