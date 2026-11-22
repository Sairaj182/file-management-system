# Technology stack review

## Observed stack versus documented prototype

| Layer | Requirements describe | Repository currently uses | Assessment |
|---|---|---|---|
| Monorepo/API | Next.js 14 full stack | Turborepo/pnpm, Fastify 5.8 | Keep API separation; offers clear external-client boundary. |
| Web | React/TypeScript/Tailwind | Next.js 16.3, React 19.2; starter CSS modules/global CSS, no Tailwind dependency | Keep Next app; build actual dashboard and API client. |
| Auth | JWT session with jose | Better Auth with persisted PostgreSQL sessions; Fastify JWT plugin also configured but no VaultFS JWT route use found | Prefer one session authority. Remove/justify unused JWT plugin/secret after compatibility review. |
| Password | bcryptjs | Better Auth credential handling plus manual scrypt creation/reset in user routes; bcryptjs and argon2 are declared API deps | Standardize on Better Auth-managed credentials; remove unused alternatives only after code/dependency audit. |
| Metadata | JSON | Prisma 7/PostgreSQL with migrations | Retain relational metadata. Transactions, constraints, and migrations fit multi-user concurrency better than shared JSON. |
| Object storage | Local filesystem, later S3 | No VaultFS storage; AWS/MinIO variables and AWS SDK dependency hint exist | Add provider abstraction and a clear first backend. Local disk is easiest for self-hosted MVP; S3-compatible provider can follow behind same contract. |
| Rate limiting | Simple module | Fastify rate-limit, Better Auth limits; Fastify global=false | Require explicit route policy and shared Redis store for horizontal scaling. Redis is configured in env but no rate-limit store wiring found. |
| Workers | Not specified | BullMQ/ioredis dependencies and Redis config present, no VaultFS worker/queue workflow found | Add only when async scanning, large-file processing, or reconciliation is implemented. |

Dependency versions above are manifest declarations, not installed/runtime versions. Lockfile exists, but install and compatibility checks were unavailable.

## Recommended direction

- Retain Fastify, PostgreSQL, Prisma, and package boundaries. Avoid migration to a Next full-stack API: the standalone API better serves multiple applications and isolates storage concerns.
- Keep Better Auth as session authority unless a concrete requirement disproves fit. Remove unused `@fastify/jwt` wiring once all consumers and deployment compatibility have been checked; avoid two parallel auth models.
- Use Prisma initially because the schema/migrations and repositories already exist. Drizzle offers no concrete benefit sufficient to justify a new ORM and conversion now. Keep persistence behind domain services/repositories where it reduces route coupling.
- Add `Warehouse`, `WarehouseMember`/policy, `StoredFile`, `ApiKey` digest/scope/revocation, and audit models through reviewed additive migrations. Define uniqueness, foreign keys, indexes, deletion lifecycle, and retention first.
- Define a `StorageProvider` port. Start with a local filesystem backend for a self-hosted single-node MVP only if its path, permissions, durability, backup, and volume behavior are controlled. Add S3-compatible implementation for multi-node/high availability, remote backup, or large scale; do not pass raw object-store credentials to clients.
- Introduce BullMQ only for durable asynchronous work such as malware scanning, checksum/metadata extraction, or orphan reconciliation. A queue cannot replace synchronous authorization and metadata integrity.
- Wire shared Redis-backed rate limiting when more than one API replica is deployed or abuse controls must survive restarts; ensure fail-open/fail-closed behavior is explicitly selected.

## Migration and deployment considerations

Current Postgres-backed identity/RBAC data is valuable and should be preserved. Additive Prisma migrations can extend it. Avoid replacing identity/session tables or changing auth provider in the same delivery as initial file storage. Test backup/restore and migration against a disposable database before production. Decouple migrations and seeding from API boot. Ensure object storage and metadata backups have coordinated retention and restore procedures.

The `.env.example` currently contains non-secret-looking example values and required unrelated provider variables. Treat it as configuration documentation only; do not reuse defaults in deployments. Split optional product integrations from required VaultFS runtime config and document exact secret provisioning.
