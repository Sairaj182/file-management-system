import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { createApiKey, getApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "../../services/api-keys";
import { API_KEY_SCOPES } from "../../security/api-key";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(3).refine((items) => new Set(items).size === items.length, "Scopes must be unique"),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable().refine((value) => !value || new Date(value) > new Date(), "Expiry must be in the future"),
});
const rotateSchema = z.object({ expiresAt: z.string().datetime({ offset: true }).optional().nullable().refine((value) => !value || new Date(value) > new Date(), "Expiry must be in the future") });

export const apiKeyManagementRoutes: FastifyPluginAsync = async (app) => {
  app.post("/:dockyardId/api-keys", { preHandler: [requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { dockyardId } = request.params as { dockyardId: string };
    const result = await createApiKey((request as any).user.id, dockyardId, { name: parsed.data.name, scopes: parsed.data.scopes, expiresAt: parsed.data.expiresAt === undefined ? undefined : parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null });
    if (result.status !== "ok") return reply.status(404).send({ error: "Dockyard not found" });
    return reply.status(201).send({ success: true, data: result.metadata, secret: result.secret });
  });

  app.get("/:dockyardId/api-keys", { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { dockyardId } = request.params as { dockyardId: string };
    const result = await listApiKeys((request as any).user.id, dockyardId);
    if (!result) return reply.status(404).send({ error: "Dockyard not found" });
    return reply.send({ success: true, data: result });
  });

  app.get("/:dockyardId/api-keys/:keyId", { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { dockyardId, keyId } = request.params as { dockyardId: string; keyId: string };
    const result = await getApiKey((request as any).user.id, dockyardId, keyId);
    if (!result) return reply.status(404).send({ error: "API key not found" });
    return reply.send({ success: true, data: result });
  });

  app.post("/:dockyardId/api-keys/:keyId/rotate", { preHandler: [requireAuth], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = rotateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { dockyardId, keyId } = request.params as { dockyardId: string; keyId: string };
    const result = await rotateApiKey((request as any).user.id, dockyardId, keyId, { expiresAt: parsed.data.expiresAt === undefined ? undefined : parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null });
    if (result.status === "legacy") return reply.status(409).send({ error: "Legacy API records cannot be rotated; create a new API key" });
    if (result.status !== "ok") return reply.status(404).send({ error: "API key not found" });
    return reply.send({ success: true, data: result.metadata, secret: result.secret });
  });

  app.delete("/:dockyardId/api-keys/:keyId", { preHandler: [requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { dockyardId, keyId } = request.params as { dockyardId: string; keyId: string };
    const result = await revokeApiKey((request as any).user.id, dockyardId, keyId);
    if (result !== "ok") return reply.status(404).send({ error: "API key not found" });
    return reply.status(204).send();
  });
};
