import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma, type Prisma } from "@repo/database";
import { z } from "zod";
import { lockDockyard } from "./dockyard-access";

export const memberRoleSchema = z.enum(["ADMIN", "MANAGER", "VIEWER"]);
export const normalizedEmail = z.string().trim().toLowerCase().email().max(254);
export const createUserSchema = z.object({
  email: normalizedEmail,
  password: z.string().min(8).max(128),
  dockyardId: z.string().trim().min(1).max(100),
  role: memberRoleSchema,
}).strict();

async function canProvisionUser(db: Prisma.TransactionClient, actorId: string) {
  const actor = await db.user.findFirst({
    where: { id: actorId, banned: false, roles: { some: { role: { name: "Super Admin" } } } },
    select: { id: true },
  });
  return Boolean(actor);
}

export async function createManagedUser(actorId: string, input: z.infer<typeof createUserSchema>) {
  if (!(await canProvisionUser(prisma, actorId))) return { status: "forbidden" } as const;
  const password = await hashPassword(input.password);
  return prisma.$transaction(async tx => {
    if (!(await canProvisionUser(tx, actorId))) return { status: "forbidden" } as const;
    if (!(await lockDockyard(tx, input.dockyardId))) return { status: "notFound" } as const;
    const user = await tx.user.create({
      data: { id: randomUUID(), email: input.email, name: input.email },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    await tx.account.create({
      data: { id: randomUUID(), accountId: user.id, userId: user.id, providerId: "credential", issuer: "local:credential", password },
    });
    await tx.dockyardMember.create({
      data: { dockyardId: input.dockyardId, userId: user.id, addedById: actorId, role: input.role },
    });
    await tx.userCreationAudit.create({
      data: { actorUserId: actorId, targetUserId: user.id, dockyardId: input.dockyardId, dockyardRole: input.role },
    });
    return { status: "ok", user } as const;
  });
}
