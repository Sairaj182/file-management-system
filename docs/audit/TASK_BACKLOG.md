# VaultFS actionable task backlog

Complexity: S small, M medium, L large, XL extra large. Priorities: P0 release blocker; P1 essential MVP; P2 product completion; P3 optional/future. Required tests are acceptance criteria, not claims that tests currently exist.

## Phase 0 — Stabilization

| ID | Task | Priority | Dependencies | Size | Relevant modules | Acceptance criteria | Required tests |
|---|---|---:|---|---:|---|---|---|
| ST-01 | Remove raw cookie/header data from auth logs; define redaction policy. | P0 | — | S | `apps/api/src/middleware/auth.ts` | **Implemented:** logs no longer include cookie/header/error objects; correlation remains Fastify request-level. | Regression test asserts secret cookie absent from captured auth logs. |
| ST-02 | Minimize `/api/health` response; separate internal readiness diagnostics. | P0 | — | S | `apps/api/src/routes/health.ts` | **Implemented:** only `status` is public; database errors/config are suppressed. | Regression test simulates DB error and checks exact public response. |
| ST-03 | Pin trusted proxy, HTTPS and cookie-domain/session policy. | P0 | Deployment topology decision | M | `apps/api/src/app.ts`, `packages/auth/src/server/auth.ts`, compose | **Implemented safe default:** proxy trust is off; cross-subdomain cookie sharing is explicit `COOKIE_DOMAIN` opt-in. Deployments must set `TRUST_PROXY` to the IP/CIDR allowlist of known proxies. | Spoofed forwarding and cookie attributes require environment integration validation. |
| ST-04 | Establish real test/typecheck/lint/build scripts and CI baseline. | P0 | Dependencies available | M | root/package manifests, `turbo.json`, CI | **Implemented:** pinned pnpm 9, frozen install, Node test runner, workspace validation, CI, and real PostgreSQL integration scripts verified. | Clean frozen install, typecheck, lint, unit, integration, and build pass; see Phase 1 reports. |
| ST-05 | Resolve Dockyard versus Warehouse domain and complete/remove placeholder POST. | P0 | — | M | `apps/api/src/routes/admin/dockyard.ts`, Prisma schema | **Implemented:** Dockyard is Warehouse; creation makes its actor an Owner; no duplicate model. | Real PostgreSQL HTTP creation/authorization tests pass. |
| ST-06 | Decouple migration/seed from API startup and make bootstrap safe. | P0 | Deployment approach | M | `compose.yml`, database seed scripts | **Implemented:** container starts API only; explicit `db:migrate:deploy` and `db:bootstrap`. Super Admin seed does not log password. | Compose and disposable DB idempotency validation pending. |
| ST-07 | Define role hierarchy and constrain system-role assignment. | P0 | ST-04 | L | `apps/api/src/routes/roles/index.ts`, `apps/api/src/routes/users/index.ts`, `packages/rbac` | **Implemented:** reserved Super Admin name; ordinary system-role grants are restricted; `roleIds` requires Super Admin. | Positive/negative real HTTP checks pass in Checkpoint 1. |
| ST-08 | Normalize recovery inputs and reduce enumeration/abuse. | P0 | Shared limiter design | M | recovery/auth routes, auth plugin | **Implemented in public recovery routes:** valid phone normalization, generic check/cooldown responses, IP rate limits and atomic counter increments. Better Auth OTP behavior and distributed/shared throttling still require verification. | Unit/regression tests added for phone normalization; enumeration and multi-instance tests pending. |

## Phase 1 — Core Architecture

| ID | Task | Priority | Dependencies | Size | Relevant modules | Acceptance criteria | Required tests |
|---|---|---:|---|---:|---|---|---|
| AR-01 | Define VaultFS domain/API contract and migration plan. | P1 | ST-05 | M | `docs/PROJECT_REQUIREMENTS.md`, database schema, API docs | **Checkpoint 2 implemented:** Dockyard=Warehouse, membership roles, ownership invariant, existing-model compatibility and route contract documented. | Proposal and migration review completed; integration routes verified. |
| AR-02 | Extend existing Dockyards and Api models; add membership, file metadata/lifecycle, API-key metadata, audit models and indexes via additive migration. | P1 | AR-01 | L | `packages/database/prisma/schema.prisma`, migrations | **Checkpoint 2 implemented:** preserve Dockyard IDs and Api relations; creator-owner backfill; no duplicate Warehouse model or file binaries. | Migration applied to disposable PostgreSQL; pre/post Dockyard IDs and membership backfill verified. |
| AR-03 | Create domain service/repository boundaries and transaction conventions. | P1 | AR-02 | L | `apps/api/src/routes`, new domain packages | **Partial:** reusable Dockyard capability policies and transactional membership service added; broader file/key services remain. | White-box role matrix and real database membership/race tests pass; extend to later workflows. |
| AR-04 | Define `StorageProvider` interface and safe local implementation with opaque object keys. | P1 | AR-01 | L | `apps/api/src/storage`, API config | **Checkpoint 4 implemented:** no caller path concatenation; streaming put/read/delete/stat, private staging, atomic finalize, bounds and normalized failures. | Temporary-root white-box coverage passes; PostgreSQL-backed file workflows pass. |
| AR-05 | Define config split for required VaultFS services versus optional integrations. | P1 | ST-04 | M | `apps/api/src/env.ts`, `.env.example`, compose | Unused Google/Gemini/AWS credentials do not block unrelated core startup; production secrets validated. | Config schema matrix tests. |

## Phase 2 — Authentication and Authorization

| ID | Task | Priority | Dependencies | Size | Relevant modules | Acceptance criteria | Required tests |
|---|---|---:|---|---:|---|---|---|
| AU-01 | Consolidate admin-created and reset credentials through Better Auth-compatible APIs. | P0 | ST-04 | L | user routes, `packages/auth` | New user login and password reset use the same supported hash path. | Create/login/change/reset/legacy account compatibility tests. |
| AU-02 | Implement Dockyard-scoped authorization policies for users/admins. | P1 | AR-02, ST-07 | L | `apps/api/src/security/dockyard-policy.ts`, `apps/api/src/services/dockyard-access.ts` | **Checkpoint 2 implemented:** Dockyard APIs use membership; Admin has no bypass; explicit Super Admin access is audited. API-key checks also bind credentials to one Dockyard. | Real HTTP membership, Admin isolation, Super Admin audit, and concurrent owner checks pass. |
| AU-03 | Implement API key create/list/rotate/revoke/validate with hashed secrets and scopes. | P1 | AR-02, AU-02 | L | `apps/api/src/security/api-key.ts`, `apps/api/src/services/api-keys.ts`, key routes/middleware, schema | **Checkpoint 3 implemented:** random scoped keys, digest-only persistence, one-time disclosure, expiry/revocation, immediate rotation, strict API auth, active Dockyard and route binding checks. | White-box and real PostgreSQL HTTP checks cover issuance, scope, viewer/admin denial, invalid/expired/revoked keys, rotation, redacted audit, inactive Dockyard and concurrent use/revoke. |
| AU-04 | Configure shared rate limiting and route policies. | P1 | Redis availability decision | M | `apps/api/src/app.ts`, auth/recovery and integration routes, Redis lib | **Partial:** API-key integration probe and management endpoints have route limits; integration probe keys rate-limit by a digest-derived identity. Configure a shared store/outage policy before horizontally scaled production. | Per-key/route limit config is present; multi-instance shared counter and bypass tests remain. |
| AU-05 | Add security audit event service for auth/admin/key/file actions. | P1 | AR-02 | M | `DockyardAuditEvent`, Dockyard services | **Partial:** Dockyard and key lifecycle/auth success/rejection events are audited; Super Admin key operations are explicit. Append-only database roles and future file events remain. No raw secret or digest is stored in event metadata. | Super Admin event assertion, key-use/rejection audit and secret-redaction integration checks; broaden in later checkpoints. |

## Phase 3 — File Management

| ID | Task | Priority | Dependencies | Size | Relevant modules | Acceptance criteria | Required tests |
|---|---|---:|---|---:|---|---|---|
| FI-01 | Implement multipart single/multiple upload with limits, staged storage, and metadata lifecycle. | P1 | AR-02, AR-04, AU-02 | XL | `apps/api/src/routes/files.ts`, service, provider | **Checkpoint 4 implemented and integration-tested:** bounded stream, opaque staging, SHA-256, signature/decoder checks, partial batch response and lifecycle. | Unit and 20 real HTTP/PostgreSQL tests pass. |
| FI-02 | Implement authorized list and binary download streaming. | P1 | FI-01, AU-02 | L | file routes/provider | **Implemented and integration-tested:** route Dockyard binding, membership/scope checks, AVAILABLE-only stream, safe headers. | Isolation, file workflow, and permission integration tests pass. |
| FI-03 | Implement delete lifecycle and orphan reconciliation. | P1 | FI-01, AR-04 | L | file service/provider | **Implemented and integration-tested:** DELETING/DELETED tombstone workflow and explicit recovery command. | Reconciliation and concurrent deletion integration tests pass. |
| FI-04 | Add verification/checksum workflow and verification audit fields. | P1 | FI-01, AU-05 | M | file schema/routes | **Implemented and integration-tested:** stream SHA-256; mismatches move to QUARANTINED; verify action audited. | Checksum mismatch/quarantine coverage passes. |
| FI-05 | Implement short-lived signed download tokens. | P1 | FI-02, AU-02 | M | signing service/download route | **Implemented and integration-tested:** HMAC binds Dockyard/file/expiry; TTL capped; token compared safely and current file state checked. | Tamper, expiry, scope, deleted/quarantined state coverage passes. |
| FI-06 | Add content inspection and malware scanning integration/policy. | P1 before public untrusted upload | FI-01, queue decision | L | upload pipeline, worker | **Partial:** PNG/JPEG/WebP signature plus decoder validation; no malware scanner is integrated and validation must not be presented as malware clearance. | Add scanner integration, timeout/failure/retry cases before public untrusted uploads. |

## Phase 4 — Dashboards and API Integration

| ID | Task | Priority | Dependencies | Size | Relevant modules | Acceptance criteria | Required tests |
|---|---|---:|---|---:|---|---|---|
| UX-01 | Build admin dashboard for users, warehouses, keys, files, verification. | P2 | AU-02, AU-03, FI-04 | XL | `apps/web/app`, API client | Role-aware screens, pagination, actionable errors, no secret re-display. | Component/e2e role matrix. |
| UX-02 | Build user dashboard for warehouse files and upload/download/delete/signed links. | P2 | FI-01..05 | XL | `apps/web/app`, API client | Only assigned warehouse content shown; upload progress and failure states handled. | E2E user workflow and cross-tenant denial. |
| UX-03 | Publish OpenAPI, API key onboarding and external integration examples. | P1 | AU-03, FI routes | M | API app/docs | **Partial:** key onboarding, actual file routes, Node upload example, limits, scopes and errors documented; OpenAPI/versioned contract remain. | OpenAPI generation/contract drift test; smoke script is implemented. |

## Phase 5 — Production Hardening

| ID | Task | Priority | Dependencies | Size | Relevant modules | Acceptance criteria | Required tests |
|---|---|---:|---|---:|---|---|---|
| PR-01 | Add operational monitoring, structured redacted logs and alerts. | P1 before production | ST-02, AU-05 | M | API/deployment | Health signals and storage/queue/db failures observable without secrets. | Failure injection and alert checks. |
| PR-02 | Implement backup/restore and disaster recovery runbook for DB and object store. | P1 before production | AR-04, AR-02 | L | deployment/docs | Restore tested to separate environment; consistency and RPO/RTO stated. | Restore drill, checksum reconciliation. |
| PR-03 | Load/concurrency test uploads, downloads, metadata and shared rate limits. | P1 before scale | FI-01..05, AU-04 | L | API/storage/deployment | Documented service limits and no unauthorized cross-tenant response under load. | Repeatable load suite and race tests. |
| PR-04 | Add S3-compatible provider if multi-node/durable remote storage is required. | P2 | AR-04 | L | storage package/config | Same provider contract; private bucket policy and multipart cleanup. | S3-compatible integration suite. |
| PR-05 | Add durable workers for scanning/reconciliation only where needed. | P2 | FI-06, PR-04 decision | L | BullMQ/Redis | Retries/idempotency/dead-letter and shutdown behavior defined. | Worker failure/replay/duplicate tests. |
