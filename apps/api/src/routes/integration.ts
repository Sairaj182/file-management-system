import type { FastifyPluginAsync } from "fastify";
import { apiKeyRateLimitIdentity, requireApiKey } from "../middleware/api-key-auth";

export const integrationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", {
    preHandler: [requireApiKey()],
    config: { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: apiKeyRateLimitIdentity } },
  }, async (request) => {
    const principal = request.apiKeyAuth!;
    const expiresAt = principal.expiresAt;
    return {
      success: true,
      data: {
        apiKeyId: principal.keyId,
        dockyardId: principal.dockyardId,
        scopes: principal.scopes,
        expiresAt,
        expirationStatus: expiresAt ? (expiresAt <= new Date() ? "expired" : "valid") : "never",
      },
    };
  });
};
