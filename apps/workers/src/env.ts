import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z
    .string()
    .optional()
    .transform((p) => p?.trim() || undefined),
  REDIS_DB: z.coerce.number().default(1), // BullMQ queues
  CACHE_REDIS_DB: z.coerce.number().default(2), // API cache (future)
  SOCKET_REDIS_DB: z.coerce.number().default(3), // Socket.io adapter (future)
  /* Email queue - SMTP (all optional; skips email if not configured). Same vars/values
     as apps/api's contact form - shared SMTP account, not a separate config. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Eduteria Website <smtpapi@eduteria.com>"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
