import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@repo/database";
import { DockyardPermissions } from "@repo/rbac";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/rbac";
import { permissionService } from "../../rbac";
import {
  addDockyardMember,
  canViewDockyard,
  listAccessibleDockyards,
  listDockyardMembers,
  removeDockyardMember,
  updateDockyardMemberRole,
} from "../../services/dockyard-access";
import { createDockyardSchema } from "./dockyard-schema";

export { createDockyardSchema } from "./dockyard-schema";

const memberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(["OWNER", "MANAGER", "VIEWER"]),
});

function sendMutationResult(reply: FastifyReply, result: { status: string; value?: unknown }) {
  switch (result.status) {
    case "ok":
      return reply.send({ success: true, ...(result.value === undefined ? {} : { data: result.value }) });
    case "lastOwner":
      return reply.status(409).send({ error: "A Dockyard must retain at least one owner" });
    case "forbidden":
    case "notFound":
    case "targetNotFound":
    case "memberNotFound":
      return reply.status(404).send({ error: "Dockyard or member not found" });
    default:
      return reply.status(500).send({ error: "Membership operation failed" });
  }
}

export const dockyardRoutes: FastifyPluginAsync = async (app) => {
  const listByStatus = (status?: "ACTIVE" | "INACTIVE" | "INCUSTODY" | "SUSPENDED") =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const actor = (request as any).user;
      const dockyards = await listAccessibleDockyards(actor.id, status);
      return reply.send({ success: "true", data: dockyards });
    };

  app.get("/", { preHandler: [requireAuth] }, listByStatus());
  app.get("/active", { preHandler: [requireAuth] }, listByStatus("ACTIVE"));
  app.get("/inactive", { preHandler: [requireAuth] }, listByStatus("INACTIVE"));
  app.get("/incustody", { preHandler: [requireAuth] }, listByStatus("INCUSTODY"));
  app.get("/suspended", { preHandler: [requireAuth] }, listByStatus("SUSPENDED"));

  app.get(
    "/:dockyardId/members",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { dockyardId } = request.params as { dockyardId: string };
      const actor = (request as any).user;
      const members = await listDockyardMembers(actor.id, dockyardId);
      if (!members) return reply.status(404).send({ error: "Dockyard not found" });
      return reply.send({ success: true, data: members });
    },
  );

  app.post(
    "/:dockyardId/members",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = memberSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { dockyardId } = request.params as { dockyardId: string };
      const actor = (request as any).user;
      try {
        const result = await addDockyardMember(actor.id, dockyardId, parsed.data.userId, parsed.data.role);
        if (result.status === "ok") return reply.status(201).send({ success: true, data: result.value });
        return sendMutationResult(reply, result);
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          return reply.status(409).send({ error: "User is already a Dockyard member" });
        }
        throw error;
      }
    },
  );

  app.patch(
    "/:dockyardId/members/:userId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = z.object({ role: memberSchema.shape.role }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { dockyardId, userId } = request.params as { dockyardId: string; userId: string };
      const actor = (request as any).user;
      const result = await updateDockyardMemberRole(actor.id, dockyardId, userId, parsed.data.role);
      return sendMutationResult(reply, result);
    },
  );

  app.delete(
    "/:dockyardId/members/:userId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { dockyardId, userId } = request.params as { dockyardId: string; userId: string };
      const actor = (request as any).user;
      const result = await removeDockyardMember(actor.id, dockyardId, userId);
      return sendMutationResult(reply, result);
    },
  );

  app.get(
    "/:dockyardId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { dockyardId } = request.params as { dockyardId: string };
      const actor = (request as any).user;
      if (!(await canViewDockyard(actor.id, dockyardId))) {
        return reply.status(404).send({ error: "Dockyard not found" });
      }
      const dockyard = await prisma.dockyards.findUnique({ where: { id: dockyardId } });
      if (!dockyard) return reply.status(404).send({ error: "Dockyard not found" });
      const member = await prisma.dockyardMember.findUnique({
        where: { dockyardId_userId: { dockyardId, userId: actor.id } },
        select: { role: true },
      });
      return reply.send({ success: true, data: { ...dockyard, memberRole: member?.role ?? null } });
    },
  );

  app.post(
    "/",
    {
      preHandler: [
        requireAuth,
        authorize({ permission: DockyardPermissions.CREATE_ANY }),
      ],
    },
    async (request, reply) => {
      const parsed = createDockyardSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const actor = (request as any).user;
      const authorization = await permissionService.getAuthorizationContext(actor.id);
      const dockyard = await prisma.$transaction(async (tx) => {
        const created = await tx.dockyards.create({
          data: {
            notes: parsed.data.notes,
            status: "ACTIVE",
            createdById: actor.id,
          },
        });
        await tx.dockyardMember.create({
          data: { dockyardId: created.id, userId: actor.id, role: "OWNER", addedById: actor.id },
        });
        await tx.dockyardAuditEvent.create({
          data: {
            dockyardId: created.id,
            actorUserId: actor.id,
            action: authorization.isSuperAdmin ? "SUPER_ADMIN_DOCKYARD_CREATE" : "DOCKYARD_CREATED",
            metadata: {
              initialOwnerUserId: actor.id,
              ...(authorization.isSuperAdmin ? { accessMode: "global" } : {}),
            },
          },
        });
        return created;
      });
      return reply.status(201).send({ success: true, data: dockyard });
    },
  );
};
