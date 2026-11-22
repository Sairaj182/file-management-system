import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import { env } from "./env";
import { registerRoutes } from "./routes";

export function buildApp() {
  const app = Fastify({
    routerOptions: { maxParamLength: 1024 },
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      redact: ["req.headers.x-api-key", "req.headers.authorization", "req.headers.cookie"],
      serializers: {
        req(request) {
          const requestUrl = String(request.url ?? "");
          const safeUrl = requestUrl.startsWith("/api/files/signed/")
            ? "/api/files/signed/[redacted]"
            : requestUrl.split("?", 1)[0];
          return {
            method: request.method,
            url: safeUrl,
            hostname: request.hostname,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          };
        },
      },
    },
    // Forwarded headers are untrusted unless the deployment explicitly names
    // trusted proxy IPs/CIDRs (comma-separated in TRUST_PROXY).
    trustProxy: env.TRUST_PROXY,
  });

  app.register(fastifyCors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  });
  
  app.register(fastifyCookie);

  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: "auth_token", signed: false },
  });

  app.register(fastifyMultipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: env.FILE_MAX_SIZE_BYTES,
      files: env.FILE_MAX_COUNT + 1,
      fields: 10,
      parts: env.FILE_MAX_COUNT + 12,
    },
  });

  // Global registration only - `global: false` means no route is limited
  // unless it opts in via `{ config: { rateLimit: {...} } }`.
  app.register(fastifyRateLimit, { global: false });

  registerRoutes(app);

  return app;
}
