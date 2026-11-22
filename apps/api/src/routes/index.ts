import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health";
import { authRoutes } from "./auth";
import { rolesRoutes } from "./roles";
import { usersRoutes } from "./users";
import { recoveryRoutes } from "./recovery";
import { adminRecoveryRoutes } from "./admin/recoveries";
import { dockyardRoutes } from "./admin/dockyard";
import { apiKeyManagementRoutes } from "./admin/api-keys";
import { integrationRoutes } from "./integration";
import { fileRoutes, signedFileRoutes } from "./files";

export function registerRoutes(app: FastifyInstance) {
  app.register(healthRoutes, { prefix: "/api" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(rolesRoutes, { prefix: "/api/roles" });
  app.register(usersRoutes, { prefix: "/api/users" });
  app.register(recoveryRoutes, { prefix: "/api/recovery" });
  app.register(adminRecoveryRoutes, { prefix: "/api/admin" });
  app.register(dockyardRoutes, {prefix: "/api/dockyard"});
  app.register(apiKeyManagementRoutes, { prefix: "/api/dockyard" });
  app.register(integrationRoutes, { prefix: "/api/integration" });
  app.register(fileRoutes, { prefix: "/api/dockyard" });
  app.register(signedFileRoutes, { prefix: "/api/files" });
}
