
# VaultFS testing plan

## Checkpoint 6 release checks

The host suites use the existing disposable developer test database. The performance, runtime and backup checks use separate Docker projects with private PostgreSQL volumes. Create the release fixture once:

```sh
node scripts/release-env.mjs
docker compose --env-file release-artifacts/primary.env -f compose.release.yml -p vaultfs-release-test build
node --env-file=release-artifacts/primary.env scripts/release-docker.mjs start
pnpm test:docker
node --env-file=release-artifacts/primary.env scripts/release-docker.mjs restore
pnpm test:all
pnpm test:report
```

The restore check expects a fresh `vaultfs-release-restore` project. Its guard refuses a restore into a database with existing public tables. Keep `release-artifacts/` private because the recovery drill writes database and object backups along with separate synthetic secrets. The two release projects use API/web ports 4415/4416 and 4425/4426.

`test:all` runs the seven categories in order, records exit codes and elapsed time in `release-artifacts/test-summary.json`, and fails if any category fails. `test:report` prints the latest run. Node's unit and white-box entry points intentionally overlap, as do the HTTP black-box and PostgreSQL integration entry points.

The performance fixture generates one PNG under 64 KiB. It launches up to 40 measured calls over approximately 12 seconds, in batches of up to two active calls every 600 ms. It stops launching at 25 seconds and each HTTP request has an 8-second timeout. Authentication probe time includes HTTP, credential lookup and audit. Upload/download throughput is an application-level average for that fixture. The smoke thresholds are ten successful operations of each kind, zero errors, two concurrent requests and p95 below one second for each kind. Docker statistics sample API and PostgreSQL CPU and memory before, during and after the run. This is a regression baseline for the local profile and does not establish production capacity.

## Checkpoint 5 browser suites

Use Node.js 22.12 or later and install Playwright Chromium with `pnpm --filter web exec playwright install chromium`.
Run `pnpm test:acceptance` and `pnpm test:usability` from the repository root.
They load ignored `.env.test.local`, require the migrated disposable
`vaultfs_p1test_1117a` database and its bootstrapped test account, and launch
real Fastify and Next.js services on loopback ports 4315 and 4316.
The Next.js test server uses a separate build directory.
The runner gives each invocation a fresh temporary storage root and signing secret.
Run these suites sequentially because they use the same ports and database.

Acceptance drives the browser through authentication, Dockyard creation,
API key issuance, external upload, file management and revocation. Usability
runs axe and checks mobile overflow and keyboard dismissal of the key dialog.
Screenshots are written to the ignored `apps/web/test-results/usability/` directory.

Testing commands are real checks; unfinished categories are documented here without success-shaped placeholder scripts.

## Checkpoint 4 commands

- `pnpm test` — API unit/security tests.
- `pnpm test:whitebox` — internal security, storage provider, content policy, signed URL, key and Dockyard role policy tests.
- `pnpm test:blackbox` — external HTTP behavior tests against Fastify, Better Auth, and disposable PostgreSQL.
- `pnpm test:integration` — real PostgreSQL, auth/RBAC, API-key, file routes, local storage, lifecycle, isolation and concurrency checks.
- `pnpm check-types`, `pnpm lint`, and `pnpm build` — workspace validation.

Black-box and integration checks require Docker PostgreSQL plus an ignored `.env.test.local` whose `DATABASE_URL` points exactly to the disposable database `vaultfs_p1test_1117a`. The suite asserts this database name before it starts. Apply migrations and bootstrap the test-only Super Admin before running those checks:

```powershell
pnpm exec dotenv -e .env.test.local -- pnpm db:migrate:deploy
pnpm exec dotenv -e .env.test.local -- pnpm db:bootstrap
pnpm test:integration
```

Checkpoint 4 adds the additive migration `20261122120000_file_storage_quarantine` for the `QUARANTINED` lifecycle state. Integration tests use a unique OS temporary storage root and remove only that verified test directory at teardown. Never substitute a development or production URL.

Use environment values for test credentials; never point destructive fixtures at development or production databases. The current integration tests create unique fixture users and Dockyards and do not delete records. Recreate a disposable database when a clean fixture set is needed.

## Seven test categories

| Category    | Current status                    | Coverage / next work                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| White-box   | Started; `pnpm test:whitebox`   | Session logging, health response, input policies, global role safeguards, Dockyard capability matrix, key digest/scope, filename/content signatures, local storage streaming/limits/cleanup, and signed token binding/tampering/expiry.                                                                         |
| Black-box   | Started; `pnpm test:blackbox`   | Real HTTP requests verify auth, role boundaries, Dockyard isolation, API key lifecycle, file scope, upload limits, metadata/download/verify/delete, signed URLs, quarantine denial, and audit behavior. Add OpenAPI contract checks.                                          |
| Unit        | Active; `pnpm test:unit`       | Pure policy, schema, key generation/digest/scope, file policy, storage provider stream behavior and signed-token helpers. |
| Integration | Active; `pnpm test:integration` | Real PostgreSQL, auth/RBAC, Dockyard and key migration compatibility, digest persistence, expiry/revocation, file APIs with isolated filesystem storage, content checks, checksum quarantine, reconciliation, DB write failure, cross-Dockyard denial, and owner/key/file concurrency. |
| Acceptance  | Active with `pnpm test:acceptance` | Playwright covers authentication, Dockyard creation, scoped keys, external and dashboard upload, file operations, revocation and member permissions. |
| Usability   | Active with `pnpm test:usability` | Chromium mobile and desktop captures, axe checks, horizontal overflow and keyboard dialog dismissal. Manual assistive technology review remains. |
| Performance | Active; `pnpm test:performance` | Bounded Docker release benchmark for upload, download, list and authenticated probe. |
