# VaultFS security

| Area | Controls and operational boundary |
| --- | --- |
| Sessions and origin | Better Auth manages session cookies. The web gateway checks the configured origin on writes. Fastify rejects cookie-authenticated writes with a foreign Origin. HTTPS enables secure cookie transport. |
| API keys | Random scoped credentials are returned once. PostgreSQL stores digests. Expiry, immediate rotation, revocation and Dockyard binding are verified by backend tests. |
| RBAC | Global role rules and Dockyard membership are separate. Dockyard Admins manage members, Managers have file and key capabilities, and Viewers can read available files. Super Admin access is audited. |
| Provisioning | Public signup is disabled across the Better Auth server. Only a Super Admin can use the rate-limited creation endpoint, and every new account is created with a Dockyard membership. Successful provisioning records the actor, account and assignment in the audit table. |
| File storage | Opaque storage keys, private storage directories, restrictive modes, rejection of symlink targets and shard directories, and atomic finalization. Storage must have a single trusted writer with restricted host access. Path checks cannot eliminate races with a local process that already controls the storage volume. |
| Content | Bounded multipart uploads, filename/content checks and Sharp decoding for supported PNG, JPEG and WebP inputs. SHA-256 mismatch quarantines a file. Malware scanning is absent. |
| Signed downloads | HMAC links bind file, Dockyard and expiry. The server checks current lifecycle state. Protect links as bearer credentials until expiry. |
| Rate limiting | Limits are per process. Use a reverse proxy with client-aware controls and add a shared store before multiple API replicas. Internally proxied dashboard activity can share an upstream IP limit. |
| Logs and failures | Sensitive headers and signed paths are redacted. Readiness returns only status. Keep reverse-proxy logs and error collection free of tokens and cookies. |
| Headers and privileges | The dashboard blocks framing and sends no-referrer and nosniff headers. API sends no-referrer and nosniff. Compose drops app capabilities, uses non-root app users and leaves PostgreSQL unpublished. |

Before broad production exposure, validate HTTPS cookies, ingress, trusted proxies and rate limiting in the target environment. Restrict public onboarding and unused auth integrations to your deployment policy. Review dependency updates, capacity, retention and malware inspection with your deployment owner. See the [Checkpoint 6 report](CHECKPOINT_6_REPORT.md) for the local evidence.

The reference Compose database uses the image's initial database role for application access. Provision separate runtime and migration PostgreSQL roles for deployments that require database least privilege.
