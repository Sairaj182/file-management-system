# VaultFS Phase 1 Checkpoint 6

Checkpoint 6 validation is complete for the local single-host release candidate. The target production hostname, TLS ingress and operational controls require validation in the target environment.

## Changes and findings

- Added a separate release Compose topology with private PostgreSQL networking, isolated project volumes, loopback application ports, startup health checks, and explicit Prisma migration and bootstrap.
- Fixed the API container startup failure caused by extensionless TypeScript imports in workspace packages. The compiled entry point uses the existing `tsx` loader for workspace dependencies.
- Added SIGTERM and SIGINT shutdown handling and HTTP 503 for degraded database readiness.
- Added origin checks for cookie-authenticated writes and conservative response headers. Existing session, API key and Dockyard authorization services remain authoritative.
- Fixed two local storage issues found during review. The provider checks object and staging directory paths before use and transfers file descriptor ownership to the write stream before the pipeline starts. The Git ignore rule now excludes only the root data directory, so storage source files are visible for release.
- Removed both unused RBAC imports, declared the API build output in Turbo and pinned its container build tools.
- Added a bounded performance workload, seven-category test orchestration, an executable summary and a disposable backup/restore drill.

See [Deployment](DEPLOYMENT.md), [Testing](TESTING.md), [Backup and restore](BACKUP_RESTORE.md), and [Security](SECURITY.md).

## Docker and recovery evidence

The release used a fresh Compose project named `vaultfs-release-test` on loopback ports 4415 and 4416. PostgreSQL had no published port. Explicit Prisma migration applied eight repository migrations to the disposable database. A repeat migration status reported an up-to-date schema and explicit Super Admin bootstrap succeeded. Both app images built and both app containers ran as UID 1001.

The runtime drill checked Better Auth cookie attributes, both origin checks, dashboard-to-API networking, framing protection, storage ownership, downloads and signed downloads. The API logged graceful shutdown and exited with code zero on SIGTERM. After app container recreation, the existing key could still read the same bytes. API readiness returned 503 during a PostgreSQL outage and recovered after PostgreSQL restarted.

Stopping both app writers produced a custom-format PostgreSQL dump, an object archive, and a separately stored copy of the synthetic environment secrets. The fresh `vaultfs-release-restore` project restored the original file ID, size and independently checked SHA-256. The exact bytes were returned through both a restored scoped key and a signed link issued before backup. The original Better Auth session retained Super Admin access. JWT configuration was retained with the environment, and JWT-specific integration flows were outside the drill.

## Production boundaries

The release configuration is ready for a single-host staging exercise with explicit deployment settings. Target HTTPS, secure cookies across the real ingress, production traffic and off-host storage durability need deployment-specific verification. The production database should have separate runtime and migration credentials where database least privilege is required. Rate limits are process-local, the object volume is single-host, and malware scanning is absent.

The existing file reconciliation command should run with writers quiesced. Concurrent checksum quarantine and deletion have separate state transitions. The available test suite exercises concurrent download/delete and checksum quarantine separately.

## Executed tests

| Command | Result |
| --- | --- |
| `pnpm check-types` | PASS, seven workspace tasks |
| `pnpm lint` | PASS, four tasks. Both RBAC warnings resolved. |
| `pnpm build` | PASS, API and web. Turbo records the API output. |
| `pnpm test:unit` and `pnpm test:whitebox` | PASS, 14 tests each |
| `pnpm test:blackbox` and `pnpm test:integration` | PASS, 20 PostgreSQL HTTP tests each |
| `pnpm test:acceptance` | PASS, three host browser workflows |
| `pnpm test:usability` | PASS, one responsive Chromium and axe workflow |
| `pnpm test:performance` | PASS, 40 measured requests and zero errors |
| `pnpm test:all` and `pnpm test:report` | PASS, all seven categories |
| `pnpm test:docker` | PASS, three browser workflows against the recreated release containers |
| Release Compose `config --quiet` and image builds | PASS, API and web |
| `release-docker.mjs start` and `restore` | PASS, migration, bootstrap, runtime and recovery drill |
| `git diff --check` | PASS |

## Local performance baseline

The benchmark transferred a 49,456-byte PNG with a peak of two concurrent requests and a launch cap of 3.33 requests per second. It ran 40 measured requests with zero errors. Elapsed time including cleanup was 14.4 seconds. The conservative smoke threshold was p95 below 1,000 ms for each operation.

| Operation | Requests | p50 | p95 | Average transfer rate |
| --- | ---: | ---: | ---: | ---: |
| API-key authentication probe | 10 | 26.87 ms | 42.89 ms | — |
| Metadata list | 10 | 35.46 ms | 43.26 ms | — |
| Download | 10 | 22.10 ms | 35.84 ms | 1.92 MiB/s |
| Upload | 10 | 50.97 ms | 62.02 ms | 0.94 MiB/s |

Docker's before/during/after snapshots recorded API CPU at 13.96% / 7.84% / 0.06% and memory at 118.7 / 120.4 / 124 MiB. PostgreSQL CPU was 0.04% / 0.47% / 0.03% and memory was 30.73 / 33.44 / 32.99 MiB. These are coarse local samples. The authentication result includes HTTP and audit work, and the transfer rate includes application overhead.

## Release readiness checklist

| Check | Status | Evidence or boundary |
| --- | --- | --- |
| Core product workflow | PASS | Implemented and exercised locally and in Docker through three Playwright acceptance workflows. |
| Migration and bootstrap | PASS | Applied all eight migrations in the new Docker project and checked the migration ledger. |
| Cookie sessions, origin checks and API isolation | PASS | Host HTTP tests plus the Docker browser and runtime drills. |
| Non-root app execution and private PostgreSQL | PASS | Checked both app UIDs, API volume ownership and absent PostgreSQL host bindings. |
| Persistent storage | PASS | Read independently hashed bytes after recreating the app containers. |
| Graceful stop and readiness recovery | PASS | SIGTERM exited with code zero. PostgreSQL outage returned HTTP 503 and restart restored readiness. |
| Backup and separate restore | PASS | Original metadata, bytes, key, signed URL and session verified in the second Docker project. |
| Bounded local performance | PASS | 40 requests, zero errors and all latency thresholds met. |
| Reverse proxy, TLS and secure cookies in the target deployment | NOT TESTED | Runtime drill used local HTTP. |
| Production scale, failover and off-host backup recovery | NOT TESTED | Local benchmark and a single-host restore were exercised. |
| Shared rate limits and malware scanning | FAIL | Broad public production readiness requires separate work on these controls. |
