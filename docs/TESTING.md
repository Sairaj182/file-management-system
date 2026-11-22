
# VaultFS testing plan

## Checkpoint 5 browser suites

Use Node.js 22.12 or later and install Playwright Chromium with `pnpm --filter web exec playwright install chromium`.
Run `pnpm test:acceptance` and `pnpm test:usability` from the repository root.
They load ignored `.env.test.local`, require the migrated disposable
`vaultfs_p1test_1117a` database and its bootstrapped test account, and launch
real Fastify and Next.js services on loopback ports 4315 and 4316.
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
| Unit        | Started; `pnpm test`            | Pure policy, schema, key generation/digest/scope, file policy, storage provider stream behavior and signed-token helpers.                                                                                                                                                                                       |
| Integration | Active; `pnpm test:integration` | Real PostgreSQL, auth/RBAC, Dockyard and key migration compatibility, digest persistence, expiry/revocation, file APIs with isolated filesystem storage, content checks, checksum quarantine, reconciliation, DB write failure, cross-Dockyard denial, and owner/key/file concurrency. |
| Acceptance  | Active with `pnpm test:acceptance` | Playwright covers authentication, Dockyard creation, scoped keys, external and dashboard upload, file operations, revocation and member permissions. |
| Usability   | Active with `pnpm test:usability` | Chromium mobile and desktop captures, axe checks, horizontal overflow and keyboard dialog dismissal. Manual assistive technology review remains. |
| Performance | Not implemented                   | Add bounded k6 or equivalent runs only against isolated local/staging services. Measure upload/download concurrency, metadata latency, storage throughput, and resource use after storage exists.                                                                                                                         |

Coverage reporting, `test:all`, and `test:report` are not yet wired. Add them when the remaining suites can report blocked/skipped categories explicitly rather than silently returning success.
