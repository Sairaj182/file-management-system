import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKeyScope } from "@repo/database";

export const API_KEY_SCOPES = ["READ", "WRITE", "DELETE"] as const;
export type ExternalApiKeyScope = (typeof API_KEY_SCOPES)[number];

const databaseScopes: Record<ExternalApiKeyScope, ApiKeyScope> = {
  READ: "FILE_READ",
  WRITE: "FILE_WRITE",
  DELETE: "FILE_DELETE",
};

const externalScopes: Record<ApiKeyScope, ExternalApiKeyScope> = {
  FILE_READ: "READ",
  FILE_WRITE: "WRITE",
  FILE_DELETE: "DELETE",
};

export function toDatabaseScopes(scopes: ExternalApiKeyScope[]): ApiKeyScope[] {
  return scopes.map((scope) => databaseScopes[scope]);
}

export function toExternalScopes(scopes: ApiKeyScope[]): ExternalApiKeyScope[] {
  return scopes.map((scope) => externalScopes[scope]);
}

export function createApiKeyMaterial() {
  const keyPrefix = randomBytes(8).toString("hex");
  const secret = `vfs_live_${keyPrefix}_${randomBytes(32).toString("base64url")}`;
  return { keyPrefix, secret, keyDigest: digestApiKey(secret) };
}

export function digestApiKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function parseApiKeyPrefix(secret: string) {
  const match = /^vfs_live_([a-f0-9]{16})_[A-Za-z0-9_-]{43}$/.exec(secret);
  return match?.[1] ?? null;
}

export function apiKeyFailureLogContext(keyPrefix: string) {
  return { event: "api_key_auth_failed", keyPrefix };
}

export function apiKeyDigestMatches(secret: string, storedDigest: string | null) {
  if (!storedDigest || !/^[a-f0-9]{64}$/i.test(storedDigest)) return false;
  const candidate = Buffer.from(digestApiKey(secret), "hex");
  const expected = Buffer.from(storedDigest, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function apiKeyRateLimitKey(_secret: string | undefined, fallback: string) {
  // Rate limiting cannot trust a caller-supplied credential as its identity:
  // arbitrary invalid values would otherwise give every attempt a new bucket.
  return `ip:${fallback}`;
}
