# VaultFS Phase 1 Checkpoint 5

**Complete.** The dashboard and browser suites use the real Fastify API and disposable PostgreSQL. This checkpoint required no database migration.

## Dashboard

| Screen | Implemented workflow |
| --- | --- |
| Sign in | Better Auth email and password, cookie sessions, protected routes, sign-out and expired-session handling |
| Dockyards | Accessible Dockyard list, search and status filters, authorized creation and Dockyard details |
| Members | Owner and Super Admin list, add by user ID, change role and confirm removal. The API enforces the last-owner rule. |
| Files | Paginated file table, multipart uploads with progress and per-file results, metadata, authenticated image preview and download, deletion, SHA-256 verification and temporary links |
| API keys | Scope and optional expiry selection, one-time secret disclosure and copy, status and last-use metadata, confirmed rotation and revocation |
| Connect a project | Copyable server environment template, Dockyard ID, API base URL and Node.js authentication and upload example |

The dashboard shares a responsive layout and supports light and dark system preferences. The file table stacks actions beneath each file at narrow widths. Upload controls use the configured file size and count limits. Preview and download controls are restricted to AVAILABLE files.

## API compatibility

The screen-to-endpoint mapping was documented before UI implementation in [Checkpoint 5 API map](CHECKPOINT_5_API_MAP.md). The Fastify Dockyard detail response adds the authenticated caller's `memberRole`. All actions use the existing Better Auth, Dockyard, file and API key routes. A Next.js route handler streams permitted dashboard requests to Fastify and validates the browser origin on mutations. PostgreSQL and the file storage provider remain unchanged.

Member addition uses existing user IDs because there is no Dockyard-scoped user directory. Previews read the original supported image through the download route because there is no thumbnail endpoint.

The first browser run found that Next.js could reconstruct a different origin from the browser's public origin. The gateway now checks the explicit `WEB_ORIGIN` setting. Successful sign-in returns the Better Auth cookies and an empty response to browser JavaScript.

## Validation

Validation uses the existing disposable PostgreSQL database and separate temporary file storage. The browser suite runs real Fastify and Next.js servers. The acceptance suite covers the external upload journey, browser multi-file upload, member role changes and protected access. The usability suite runs axe, checks mobile overflow and tests keyboard dismissal of the key dialog.

| Command | Result |
| --- | --- |
| `pnpm check-types` | Passed. 7 workspace tasks. |
| `pnpm lint` | Passed. 4 workspace tasks, with two existing RBAC warnings. |
| `pnpm test` | Passed. 12 tests. |
| `pnpm test:whitebox` | Passed. 12 tests. |
| `pnpm test:blackbox` | Passed. 20 tests against PostgreSQL. |
| `pnpm test:integration` | Passed. 20 tests against PostgreSQL. |
| `pnpm test:acceptance` | Passed. 3 Chromium workflows. |
| `pnpm test:usability` | Passed. Chromium with desktop and mobile viewports and no axe violations in the checked screens. |
| `pnpm build` | Passed. API and Next.js application builds. |
| `docker compose --env-file .env.example config --quiet` | Passed. |
| `docker compose --env-file .env.example build web` | Passed. Built the standalone Next.js image. |

## Screenshots

[Desktop Dockyard file manager](screenshots/dockyard-desktop.png) · [Mobile Dockyard file manager](screenshots/dockyard-mobile.png)

## Deployment and remaining work

Configure the web service's internal `API_URL`, public `NEXT_PUBLIC_API_URL`, and `WEB_ORIGIN` as described in [Architecture](ARCHITECTURE.md). Include the dashboard origin in Fastify's trusted origins. The web Docker build copies the Prisma schema and config before frozen installation so the Prisma generation hook can run.

Cross-browser and manual assistive technology coverage remain open. The existing single-host storage and deployment limitations in the [Checkpoint 4 report](CHECKPOINT_4_REPORT.md) still apply.
