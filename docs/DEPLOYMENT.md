# VaultFS deployment

Use Docker with Compose v2 and enough local disk for PostgreSQL, object storage and backups. Use `compose.release.yml` with a dedicated project name. It publishes only API and web on loopback and keeps PostgreSQL on the project network. API and web run as UID 1001 with no Linux capabilities. PostgreSQL's image entrypoint manages its own user and volume permissions.

## Release settings

Provide settings using a restricted environment file outside source control or a deployment secret manager. Compose substitutes variables from the shell before the environment file, so remove conflicting exports before running commands. Avoid commands that print the expanded environment.

| Setting | Purpose |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | Initial database role, database name and generated password. Database image settings apply on volume initialization. |
| `DATABASE_URL` | Internal PostgreSQL URL with host `postgres:5432` and the selected database. URL encode reserved credential characters. |
| `BETTER_AUTH_SECRET`, `JWT_SECRET`, `FILE_SIGNING_SECRET` | Independent random secrets with at least 32 characters each. Preserve them across restarts. |
| `BETTER_AUTH_URL` | Public HTTPS API URL ending in `/api/auth`. Controls secure session cookies. |
| `WEB_ORIGIN` | Public HTTPS dashboard origin. The Compose file uses it as the API's trusted origin. |
| `NEXT_PUBLIC_API_URL`, `FILE_PUBLIC_BASE_URL` | `NEXT_PUBLIC_API_URL` is the public API base including `/api` for integration examples. `FILE_PUBLIC_BASE_URL` sets the public API origin for signed downloads. If omitted, the API uses the origin of `BETTER_AUTH_URL`. Release Compose requires an explicit value. Rebuild web after changing `NEXT_PUBLIC_API_URL`. |
| `RELEASE_API_PORT`, `RELEASE_WEB_PORT` | Host loopback ports used by the reverse proxy. |
| `VAULTFS_TAG` | Local tag for the built pair of application images. Record image digests and the source revision when promoting a tested release. |
| `FILE_MAX_SIZE_BYTES`, `FILE_MAX_COUNT`, `FILE_SIGNED_URL_MAX_TTL_SECONDS` | Shared API and dashboard limits. |

Google, Gemini and AWS credentials are optional for the core release workflow. Set real values before enabling the integrations that use them. Bootstrap credentials belong in the one-shot command's environment.

## Build, migrate and start

In the examples below, set up an alias or shell function for `dc` that runs `docker compose --env-file /secure/vaultfs.env -f compose.release.yml -p vaultfs`.

```sh
dc config --quiet
dc build
dc up -d --wait postgres
dc run --rm --no-deps -w /app/packages/database api node node_modules/prisma/build/index.js migrate status
dc run --rm --no-deps -w /app/packages/database api node node_modules/prisma/build/index.js migrate deploy
dc run --rm --no-deps -w /app/packages/database api node node_modules/prisma/build/index.js migrate status
```

An initial status check can report a nonzero exit when migrations are pending. Read the target name and migration names before proceeding. Back up an existing release before migration. To initialize a new database, export `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` from your secret manager and run:

```sh
dc run --rm --no-deps -e SUPER_ADMIN_EMAIL -e SUPER_ADMIN_PASSWORD api node /app/apps/api/node_modules/tsx/dist/cli.mjs /app/packages/database/prisma/seed/index.ts
dc up -d --wait
dc ps
```

API startup does not migrate or seed. The API readiness endpoint is `GET /api/health`. It reports only status and returns HTTP 503 if PostgreSQL is unavailable. The web health check serves `/login`.

## Reverse proxy and TLS

Terminate TLS at a host reverse proxy. Forward the dashboard and API hostnames to the matching loopback ports. Preserve request Origin, response cookies and the public host. Configure upload body size, timeouts and streaming to match the API limit. Exclude signed-link paths, credentials and cookie headers from access logs. Set HSTS at the TLS boundary after verifying your HTTPS setup. Leave `TRUST_PROXY=false` unless you can restrict it to the actual proxy addresses. If you do trust forwarding, have the proxy overwrite client-supplied forwarding headers. The proxy and any other process holding credentials must have restricted host access.

## Troubleshooting

- For unhealthy API containers, check status and filtered container logs, then confirm the internal database host and that migrations finished.
- If dashboard writes return 403, check the browser origin against `WEB_ORIGIN` and the API origin allowlist. Verify secure cookie settings with HTTPS in the target deployment.
- If upload fails after a rollout, check the mounted object volume, UID 1001 and disk space. Preserve both volumes when recreating containers.
- Before rolling back schema changes, check application compatibility. Restore the matching metadata and object snapshots into a separate environment and verify it before switching traffic.

Review [Security](SECURITY.md) and [Backup and restore](BACKUP_RESTORE.md) before production exposure.
