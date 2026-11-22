import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { auth } from "@repo/auth/server";
import { prisma } from "@repo/database";
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";

const checkUserSchema = z.object({
  phoneNumber: z.string(),
});

const setPasswordSchema = z.object({
  newPassword: z.string().min(6),
});

export async function customRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 5,
    timeWindow: "1 hour",
  });

  app.post(
    "/check-user",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 hour",
        },
      },
    },
    async (request, reply) => {
      try {
        const { phoneNumber: rawPhoneNumber } = checkUserSchema.parse(request.body);
        const parsedPhone = parsePhoneNumberFromString(rawPhoneNumber, "IN");
        if (!parsedPhone?.isValid()) return reply.status(400).send({ error: "Invalid request" });

        void parsedPhone;
        return reply.send({ success: true });
      } catch (err: any) {
        return reply
          .status(400)
          .send({ error: err.message || "Invalid request" });
      }
    },
  );

  app.post("/set-password", async (request, reply) => {
    try {
      // Create Web Headers from Fastify headers
      const webHeaders = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") {
          webHeaders.append(key, value);
        } else if (Array.isArray(value)) {
          value.forEach((v) => webHeaders.append(key, v));
        }
      }

      const session = await auth.api.getSession({
        headers: webHeaders,
      });

      if (!session) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const existingAccount = await prisma.account.findFirst({
        where: {
          userId: session.user.id,
          providerId: "credential",
        },
      });

      if (existingAccount) {
        return reply.status(403).send({
          error:
            "User already has a password. Please use the change password flow.",
        });
      }

      const { newPassword } = setPasswordSchema.parse(request.body);

      await auth.api.setPassword({
        body: {
          newPassword,
        },
        headers: webHeaders,
      });

      return reply.send({ success: true });
    } catch {
      request.log.warn({ event: "set_password_failed" }, "Set password request failed");
      return reply
        .status(400)
        .send({ error: "Failed to set password" });
    }
  });
}
