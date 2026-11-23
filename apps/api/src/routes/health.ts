import type { FastifyInstance } from "fastify";
import { prisma } from "@repo/database";
import { publicHealthResponse } from "../security/policies";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    let databaseReady = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      databaseReady = false;
    }

    return reply.code(databaseReady ? 200 : 503).send(publicHealthResponse(databaseReady));
  });
}
