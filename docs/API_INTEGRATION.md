# VaultFS API key integration

In the dashboard, sign in, create or select a Dockyard, and open **API keys**
to generate a scoped credential. Copy the secret before closing its dialog.
**Connect a project** shows the Dockyard ID, public API base URL, and a
server-side Node.js example with an authentication check. Open **Files**
after uploading from your project to preview, verify, download, share or
delete files according to your Dockyard permissions.

VaultFS calls each isolated logical storage warehouse a **Dockyard**. A Dockyard is owned and accessed through its existing Dockyard identity; an API key belongs to exactly one Dockyard.

## Create a Dockyard and key

Create a Dockyard through the authenticated API:

```http
POST /api/dockyard
Cookie: <Better Auth session>
Content-Type: application/json

{"notes":"Production assets for Example App"}
```

The actor must have the global Dockyard creation permission. The creator becomes the Dockyard Admin. The Dockyard Admin, a Manager, or an explicitly audited Super Admin can manage keys.

Issue a key using an authenticated session:

```http
POST /api/dockyard/{dockyardId}/api-keys
Cookie: <Better Auth session>
Content-Type: application/json

{"name":"Example App production","scopes":["READ","WRITE"],"expiresAt":"2027-11-18T00:00:00.000Z"}
```

`name` and `expiresAt` are optional. Omit expiry for a key without a preset expiration. `scopes` must contain one or more distinct values from `READ`, `WRITE`, and `DELETE`. The API returns the raw secret in `secret` **once**, alongside safe key metadata. Store it immediately in a secret manager. Listing or inspecting a key never returns its raw secret or digest.

## Store and use the key

Keep the key in the other application's **server-side** environment, for example `VAULTFS_API_KEY`. Do not put it in frontend JavaScript, browser storage, URLs, source control, or logs. Restrict access to the production environment variable and rotate the key if it may have been exposed.

Send the value as `X-API-Key`:

```js
const response = await fetch(`${process.env.VAULTFS_URL}/api/integration/me`, {
  headers: {
    "X-API-Key": process.env.VAULTFS_API_KEY,
  },
});

if (!response.ok) {
  throw new Error(`VaultFS credential check failed: ${response.status}`);
}

const identity = await response.json();
console.log(identity.data.dockyardId, identity.data.scopes);
```

`GET /api/integration/me` is a credential check and returns only the API key ID, Dockyard ID, granted scopes, expiry timestamp and expiration status. It does not require a Better Auth cookie or a file scope. An invalid supplied API key never falls back to session authentication.

For file APIs, request only the scope needed by the operation: `READ` for listing, metadata, download, verification, and signed URL creation; `WRITE` for uploads; and `DELETE` for deletion. Scopes are independent; `WRITE` does not imply `READ` or `DELETE`.

## File API (Checkpoint 4)

All file paths include the Dockyard ID; the API key's Dockyard must match it. Session requests instead require Dockyard membership. Multipart file parts must use PNG, JPEG, or WebP content with a matching filename extension. The default limit is 10 MiB per file and five files per request. Mixed batches return `207` with per-file results; successful files remain stored. Unsupported, malformed, empty, and oversized files are rejected. MIME headers supplied by the client are not trusted.

Upload files from a server-side Node.js process:

```js
import { basename } from "node:path";

const form = new FormData();
form.append("file", new Blob([await (await import("node:fs/promises")).readFile("./image.png")]), basename("./image.png"));
const response = await fetch(`${process.env.VAULTFS_URL}/api/dockyard/${process.env.VAULTFS_DOCKYARD_ID}/files`, {
  method: "POST",
  headers: { "X-API-Key": process.env.VAULTFS_API_KEY },
  body: form,
});
if (!response.ok) throw new Error(`VaultFS upload failed: ${response.status} ${await response.text()}`);
const result = await response.json();
console.log(result.data[0].id, result.data[0].sha256);
```

Use server-side secrets for `VAULTFS_API_KEY`; the browser must never receive the key. For large files use streaming-capable multipart tooling in the caller; VaultFS itself streams incoming parts to disk and does not buffer complete files.

Routes: `POST /api/dockyard/{dockyardId}/files`, `GET /api/dockyard/{dockyardId}/files?page=1&limit=20`, `GET /api/dockyard/{dockyardId}/files/{fileId}`, `GET /api/dockyard/{dockyardId}/files/{fileId}/download`, `POST /api/dockyard/{dockyardId}/files/{fileId}/verify`, `POST /api/dockyard/{dockyardId}/files/{fileId}/signed-url`, `DELETE /api/dockyard/{dockyardId}/files/{fileId}`, and `GET /api/files/signed/{token}`. Signed links are short-lived bearer URLs and cannot be individually revoked after issue; current deletion, quarantine, and Dockyard status are checked before download.

Run the CLI smoke flow with `VAULTFS_BASE_URL`, `VAULTFS_DOCKYARD_ID`, `VAULTFS_API_KEY`, and `FILE_SMOKE_TEST_PATH` set in the server environment: `pnpm storage:smoke` performs upload → list → download → verify → delete.

## Key lifecycle

- `GET /api/dockyard/{dockyardId}/api-keys` lists safe metadata, including a shortened prefix and last-use/revocation timestamps.
- `GET /api/dockyard/{dockyardId}/api-keys/{keyId}` returns safe metadata.
- `POST /api/dockyard/{dockyardId}/api-keys/{keyId}/rotate` issues a replacement and revokes the old key in the same database transaction. The previous key stops authenticating immediately; copy the returned replacement once.
- `DELETE /api/dockyard/{dockyardId}/api-keys/{keyId}` revokes a key. Subsequent use is rejected. Existing requests that authenticated before a concurrent revocation may finish.
- Expired and revoked credentials cannot authenticate. Keys are rejected whenever their Dockyard is not `ACTIVE`.
- Legacy `Api` rows without a key digest remain non-authenticating. They are not automatically assigned credentials.

VaultFS stores only a SHA-256 digest and a non-secret lookup prefix. Audit events omit both the raw credential and digest. Treat the returned raw key as a password: anyone who obtains it can act within its scopes on its one Dockyard.

## Errors

Responses use JSON `{ "error": ... }` except successful revocation (`204` with no body).

| Status | Meaning |
|---|---|
| `400` | Invalid body, pagination, expiry, or scope selection. |
| `401` | Missing, malformed, unknown, expired, or revoked API key. |
| `403` | Valid credential lacks the required scope, Dockyard is inactive, or route Dockyard binding does not match. |
| `404` | Session user cannot manage/access the requested Dockyard/key; response hides unauthorized resource existence. |
| `409` | Attempt to rotate a legacy `Api` row that has no key digest. Create a new key instead. |
| `429` | Route rate limit exceeded. |
| `413` | Upload exceeds configured per-file or per-request file count limits. |
| `415` | Request is not multipart. |
| `422` | File content, name, or image validation failed. |
| `503` | Metadata database or local storage is unavailable. |

The integration probe is limited to 120 requests/minute per client IP. Management endpoints have route-specific rate limits. Production deployments with multiple API replicas still need a shared rate-limit store.
