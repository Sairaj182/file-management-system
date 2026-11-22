import type { FastifyInstance } from "fastify";
import { prisma } from "@repo/database";
import { publicHealthResponse } from "../security/policies";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    let databaseReady = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      databaseReady = false;
    }

    return publicHealthResponse(databaseReady);
  });
}
