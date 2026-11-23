# VaultFS

VaultFS stores files in isolated Dockyards. Users sign in to the Next.js dashboard with Better Auth. External projects upload through Fastify using a Dockyard-scoped API key. PostgreSQL holds the metadata and the storage provider writes the file bytes to a persistent volume.

## Local development

Install Node.js 22.12 or later, pnpm 9.0.0 and Docker with Compose v2. Copy `.env.example` to an ignored `.env`, replace the example secrets, and select a development database. The example database address is for host-side processes.

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate:deploy
pnpm db:bootstrap
pnpm dev
```

Set the first administrator credentials before bootstrap. Open the dashboard at the configured `PORT_WEB`. For a fresh workspace, install the browser before running acceptance and usability tests.

```sh
pnpm --filter web exec playwright install chromium
pnpm check-types
pnpm lint
pnpm build
pnpm test:all
pnpm test:report
```

The full test suite needs both the disposable host test database and the separate Docker release stack. See [Testing](docs/TESTING.md). For release setup, migrations and TLS see [Deployment](docs/DEPLOYMENT.md). For recovery see [Backup and restore](docs/BACKUP_RESTORE.md). See [Security](docs/SECURITY.md) and the [Checkpoint 6 report](docs/CHECKPOINT_6_REPORT.md) for checked behavior and production limitations.
