import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@repo/database";
import { normalizeRecoveryPhone } from "../utils/phone";
export { normalizeRecoveryPhone } from "../utils/phone";

export const recoveryRoutes: FastifyPluginAsync = async (app) => {
  // 1. Request Account Recovery
  app.post("/request", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const schema = z.object({
      phoneNumber: z.string().trim().min(6).max(32),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body" });
    }

    const phoneNumber = normalizeRecoveryPhone(parsed.data.phoneNumber);
    if (!phoneNumber) return reply.status(400).send({ error: "Invalid request body" });

    // Check if user has exceeded max requests in the last 24 hours
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existingRequest = await prisma.accountRecoveryRequest.findFirst({
      where: {
        phoneNumber,
        windowStart: { gte: windowStart },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingRequest) {
      if (existingRequest.requestCount >= 10) {
        // Short-circuit to prevent excessive DB updates during a spam attack
        return reply.send({ success: true });
      }

      const newCount = existingRequest.requestCount + 1;
      let newStatus = existingRequest.status;
      if (newCount >= 3) {
        newStatus = "FLAGGED_SPAM";
      }

      await prisma.accountRecoveryRequest.update({
        where: { id: existingRequest.id },
        data: {
          requestCount: { increment: 1 },
          status: newStatus,
        },
      });

      return reply.send({ success: true });
    }

    // Create new request
    await prisma.accountRecoveryRequest.create({
      data: {
        phoneNumber,
        status: "PENDING",
        requestCount: 1,
        windowStart: new Date(),
      },
    });

    return reply.send({ success: true });
  });

  // 2. Check Cooldown Status
  app.get("/cooldown", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const schema = z.object({
      phoneNumber: z.string().trim().min(6).max(32),
    });

    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters" });
    }

    if (!normalizeRecoveryPhone(parsed.data.phoneNumber)) return reply.status(400).send({ error: "Invalid query parameters" });
    // Keep the legacy response shape without exposing whether a phone is throttled.
    return reply.send({ active: false, remainingSeconds: 0 });
  });
};
