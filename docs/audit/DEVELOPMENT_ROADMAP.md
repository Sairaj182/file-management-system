# VaultFS development roadmap

This roadmap follows repository evidence and dependency order. “MVP” means safe self-hosted core service; production requirements are listed separately. Detailed IDs and acceptance criteria are in [TASK_BACKLOG.md](TASK_BACKLOG.md).

## Phase 0 — Stabilization (MVP gate)

Completed in Phase 0: remove raw cookie logging and health diagnostics, default proxy trust off and cookie domain to host-only, constrain system-role assignment, normalize and throttle recovery lookups, complete Dockyard-as-Warehouse creation without schema replacement, add tool scripts/CI, and remove migration/seed work from API startup. Build, lint, typecheck, test, auth-flow, and container validation remain to be run where dependencies/runtime are available. Do not expose file endpoints until authorization foundations pass.

## Phase 1 — Core Architecture and File API

Phase 1 Checkpoints 1–4 established auth, Dockyard membership, API keys, and a tested local streaming file API. The additive quarantine migration and 20-test PostgreSQL HTTP suite pass against the disposable test database. Dashboard and product workflow work is next.

## Phase 2 — Dashboard and Product Workflows

Build user/admin screens against the stable API: login, Dockyard/member management, API-key lifecycle, upload/list/download/delete, pagination, error/empty states, and accessibility. Add acceptance and usability automation. Keep API usable by external clients.

## Phase 3 — Production Hardening

Complete security and load/concurrency tests, shared throttling, monitoring, structured redacted audit logs, backup/restore, TLS/reverse-proxy guidance, deployment profiles, migration release workflow, malware scanner integration, retention, incident procedures, and optional S3-compatible storage/worker deployment.

## MVP versus production

**Essential MVP:** PostgreSQL metadata, session auth, safe Dockyard authorization, one storage provider, bounded uploads, listing/download/delete, checksum verification, API-key lifecycle, signed links, dashboard or complete API docs, isolation tests, backups, and deployable configuration.

**Production before broad external exposure:** malware scanning policy, shared rate limiting, audit trail, restore drills, monitoring/alerts, TLS/proxy hardening, secret rotation, capacity limits, reconciliation jobs, operational runbooks, and security review. S3-compatible storage and workers are scale/availability decisions, not prerequisites for the first local-provider MVP.

Completion cannot be credibly estimated by percentage: most VaultFS product-domain features are missing. A cautious estimate is **multiple substantial engineering phases**: first deliver stabilization plus a tested vertical slice (auth → warehouse authorization → upload → authorized download), then complete admin/API integration and operational gates. Duration depends on team size, product decisions, and deployment target; this audit does not invent a calendar estimate.
