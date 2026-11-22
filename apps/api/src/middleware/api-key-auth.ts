import { prisma } from "@repo/database";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { apiKeyDigestMatches, apiKeyFailureLogContext, apiKeyRateLimitKey, parseApiKeyPrefix, toExternalScopes } from "../security/api-key";
import type { ExternalApiKeyScope } from "../security/api-key";

export type ApiKeyPrincipal = {
  keyId: string;
  dockyardId: string;
  scopes: ExternalApiKeyScope[];
  expiresAt: Date | null;
};
declare module "fastify" {
  interface FastifyRequest { apiKeyAuth?: ApiKeyPrincipal }
}

export function apiKeyRateLimitIdentity(request: FastifyRequest) {
  return apiKeyRateLimitKey(undefined, request.ip);
}

export function requireApiKey(options: { requiredScopes?: ExternalApiKeyScope[]; requestedDockyardId?: (request: FastifyRequest) => string | undefined } = {}): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers["x-api-key"];
    const secret = typeof header === "string" ? header : undefined;
    const prefix = secret ? parseApiKeyPrefix(secret) : null;
    if (!secret || !prefix) {
      request.log.warn({ event: "api_key_auth_failed" }, "API key authentication failed");
      return reply.status(401).send({ error: "Invalid API key" });
    }

    const key = await prisma.api.findUnique({ where: { keyPrefix: prefix }, select: {
      id: true, dockId: true, keyDigest: true, scopes: true, expiresAt: true, revokedAt: true,
      dockyard: { select: { status: true } },
    } });
    if (!key) {
      request.log.warn(apiKeyFailureLogContext(prefix), "API key authentication failed");
      return reply.status(401).send({ error: "Invalid API key" });
    }
    if (!apiKeyDigestMatches(secret, key.keyDigest)) {
      request.log.warn(apiKeyFailureLogContext(prefix), "API key authentication failed");
      await prisma.dockyardAuditEvent.create({ data: { dockyardId: key.dockId, action: "API_KEY_AUTH_REJECTED", metadata: { apiKeyId: key.id, reason: "invalid_secret" } } });
      return reply.status(401).send({ error: "Invalid API key" });
    }

    const now = new Date();
    let failure: { status: number; reason: string } | undefined;
    if (key.revokedAt) failure = { status: 401, reason: "revoked" };
    else if (key.expiresAt && key.expiresAt <= now) failure = { status: 401, reason: "expired" };
    else if (key.dockyard.status !== "ACTIVE") failure = { status: 403, reason: "dockyard_inactive" };
    else if (options.requestedDockyardId && options.requestedDockyardId(request) !== key.dockId) failure = { status: 403, reason: "dockyard_mismatch" };
    else if ((options.requiredScopes ?? []).some((scope) => !toExternalScopes(key.scopes).includes(scope))) failure = { status: 403, reason: "scope_denied" };

    if (failure) {
      await prisma.dockyardAuditEvent.create({ data: { dockyardId: key.dockId, action: "API_KEY_AUTH_REJECTED", metadata: { apiKeyId: key.id, reason: failure.reason } } });
      return reply.status(failure.status).send({ error: failure.status === 401 ? "Invalid API key" : failure.reason === "scope_denied" ? "Insufficient API key scope" : "Dockyard access denied" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const dockyard = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "Dockyards" WHERE "id" = ${key.dockId} FOR KEY SHARE`;
      if (!dockyard[0] || dockyard[0].status !== "ACTIVE") return false;
      const locked = await tx.$queryRaw<Array<{ id: string; revokedAt: Date | null; expiresAt: Date | null }>>`SELECT "id", "revokedAt", "expiresAt" FROM "Api" WHERE "id" = ${key.id} FOR UPDATE`;
      if (!locked[0] || locked[0].revokedAt || (locked[0].expiresAt && locked[0].expiresAt <= new Date())) return false;
      await tx.api.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
      await tx.dockyardAuditEvent.create({ data: { dockyardId: key.dockId, action: "API_KEY_AUTHENTICATED", metadata: { apiKeyId: key.id, scopes: toExternalScopes(key.scopes) } } });
      return true;
    });
    if (!updated) return reply.status(401).send({ error: "Invalid API key" });
    request.apiKeyAuth = { keyId: key.id, dockyardId: key.dockId, scopes: toExternalScopes(key.scopes), expiresAt: key.expiresAt };
  };
}
