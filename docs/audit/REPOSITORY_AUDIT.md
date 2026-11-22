# VaultFS repository audit

**Audit date:** 2026-11-17 (Asia/Calcutta)  
**Scope:** static inspection of tracked repository content; no source changes, dependency installation, migrations, or invasive security tests.  
**Evidence labels:** *Static* means inferred from source/configuration. *Verified* means executed successfully. No application behavior was runtime-verified in this audit.

## Executive assessment

This checkout is a pnpm/Turborepo monorepo containing a Fastify API, a minimal Next.js web starter, shared auth/RBAC/database packages, and PostgreSQL/Prisma foundations. It is not the Next.js 14 + local JSON metadata prototype described in the requirements. The current product domain in source appears to be user/admin account management and “Dockyards”; the core VaultFS file-storage domain is not implemented in this checkout.

The strongest existing foundations are Better Auth with persisted sessions, PostgreSQL/Prisma, a reusable permission registry/service/repository pattern, user/session administration endpoints, Dockerfiles, and a compose deployment definition. These are useful to retain after careful security fixes and model/domain alignment. No end-to-end VaultFS file workflow exists to validate.

## Repository map

| Area | Contents and entry points |
|---|---|
| `apps/api` | Fastify 5 API; `src/index.ts` starts the server, `src/app.ts` configures plugins, `src/routes/index.ts` mounts routes. |
| `apps/web` | Next.js 16.3 / React 19.2 App Router; `app/page.tsx` is the starter page. No dashboard routes or API client. |
| `packages/auth` | Better Auth setup/plugins, phone/SMS/trusted-device services, client/server exports. |
| `packages/rbac` | Permission definitions, service interfaces, and role/permission domain logic. |
| `packages/database` | Prisma schema, PostgreSQL adapter/client, migrations, seed files. |
| `packages/ui` | Three small shared UI components. |
| `packages/env`, `packages/typescript-config`, `packages/eslint-config` | Shared environment/config packages. |
| `docs/PROJECT_REQUIREMENTS.md` | Primary product specification. Its architecture and feature inventory describe a prototype not present in current source. |
| root | pnpm workspace, Turbo task graph, compose stack, Dockerfiles, `.env.example`. |

Routes registered by `apps/api/src/routes/index.ts`: health, Better Auth/custom auth, roles, users, account recovery/admin recovery, and dockyard. No warehouse/file/API-key routes are registered.

## Implementation inventory

### Present, based on static code

- Fastify server setup with CORS, cookies, JWT plugin, multipart limit (10 MiB), and opt-in Fastify rate limiting (`apps/api/src/app.ts`).
- Better Auth and Prisma-backed session/auth configuration with credential, Google, phone-number, and trusted-device features (`packages/auth/src/server/auth.ts`).
- Session lookup middleware and permission-based authorization middleware (`apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/rbac.ts`).
- User management, session revocation, role CRUD/assignment, permission listing, account-recovery request/cooldown endpoints, dockyard listing, and health endpoint.
- PostgreSQL schema models for users, sessions, accounts, verification, roles, permissions, trusted devices, recovery/cooldown, dockyards, and an `Api` relation.
- Prisma migrations and development seeds; Dockerfiles and compose configuration.

### Incomplete or absent

- No Warehouse, StoredFile, file metadata, or usable API key schema. `Api` has only IDs, dock association, creator, and timestamp.
- No storage provider interface, local filesystem implementation, S3/MinIO object workflow, upload/download/delete/verify/signing endpoints, checksum logic, or malware scan integration.
- No warehouse membership/permission model or object-level authorization.
- Dockyard `POST /api/dockyard` validates an `id` but does not create a record or send a response (`apps/api/src/routes/admin/dockyard.ts`). It is not a warehouse implementation.
- No dashboard frontend, API integration docs, OpenAPI/Swagger registration, API-key lifecycle, or integration example.
- Root README and web README remain template documents. `docs/PROJECT_REQUIREMENTS.md` documents routes/modules that do not exist here.
- No standard test suite or root `test` script. Two `packages/auth/scripts/*test.ts` scripts exist, but package scripts are placeholders that exit with “no test specified”; they are not automated test harnesses.

## Repository hygiene and delivery setup

- `compose.yml` runs PostgreSQL, API, and web; API startup runs `prisma migrate deploy` and seeds on each container start. This couples deployment startup to schema mutation and seed behavior; make migration execution an explicit release step and verify seeds are repeat-safe before production use.
- Compose passes a broad set of Google, Gemini, AWS, and auth environment variables. Current API env parsing requires credentials for unrelated Google/Gemini/AWS features (`apps/api/src/env.ts`), despite no VaultFS storage implementation.
- API Dockerfile prunes/builds `api`; web Dockerfile performs its own install and Prisma generation. Build/deploy paths require a clean-image validation when tooling and network are available.
- `turbo.json` defines build/lint/check-types but no test task. Package scripts are inconsistent (`typecheck` versus `check-types`; database/auth test placeholders).
- No CI workflow files were found. No OpenAPI spec, operational runbook, backup procedure, or production deployment guide was found.
- `git status` showed a pre-existing modification to `.gitignore`. It was not changed as part of this audit.

## Safe validation record

| Check | Result |
|---|---|
| Repository/file discovery | Completed. |
| Source/configuration review | Completed statically. |
| Dependency installation check | Blocked: `pnpm` is not available and workspace `node_modules` directories are absent. No installation attempted. |
| TypeScript checks | Not run: pnpm/dependencies unavailable. |
| Lint | Not run: pnpm/dependencies unavailable. |
| Automated tests | Not run: pnpm/dependencies unavailable; no usable test script discovered. |
| Production build | Not run: pnpm/dependencies unavailable. |
| Database/migration validation | Not run; deliberately no database connection, migration, seed, or reset attempted. |
| Runtime/API route validation | Not run; dependencies and configured services unavailable. |

No runtime behavior is claimed as verified. Static existence of a route or helper is not evidence that the workflow functions end-to-end.

## Development posture

Keep the monorepo and its separation into API, web, auth, database, RBAC, and UI packages. First stabilize auth/authorization and deployment configuration, then add a coherent VaultFS data/storage domain with transactional metadata and a provider interface. Replace or rename Dockyard only after deciding whether it represents a real product concept; do not equate it with Warehouse without an explicit product decision. See [FEATURE_MATRIX.md](FEATURE_MATRIX.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), and [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).
