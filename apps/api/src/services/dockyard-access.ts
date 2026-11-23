import type { DockyardMemberRole, DockStatus, Prisma } from "@repo/database";
import { prisma } from "@repo/database";
import { permissionService } from "../rbac";
import { hasDockyardCapability, type DockyardAction } from "../security/dockyard-policy";

function actionLabel(action: DockyardAction) {
  return action;
}

async function logGlobalAccess(actorId: string, dockyardId: string, action: DockyardAction) {
  await prisma.dockyardAuditEvent.create({
    data: {
      dockyardId,
      actorUserId: actorId,
      action: `SUPER_ADMIN_DOCKYARD_${actionLabel(action)}`,
      metadata: { accessMode: "global", resourceAuthorization: "bypass" },
    },
  });
}

export async function canDockyardAction(
  actorId: string,
  dockyardId: string,
  action: DockyardAction,
): Promise<boolean> {
  const dockyard = await prisma.dockyards.findUnique({ where: { id: dockyardId }, select: { id: true } });
  if (!dockyard) return false;

  const context = await permissionService.getAuthorizationContext(actorId);
  if (context.isSuperAdmin) {
    await logGlobalAccess(actorId, dockyardId, action);
    return true;
  }

  const membership = await prisma.dockyardMember.findUnique({
    where: { dockyardId_userId: { dockyardId, userId: actorId } },
    select: { role: true },
  });
  return Boolean(membership && hasDockyardCapability(membership.role, action));
}

export const canViewDockyard = (actorId: string, dockyardId: string) =>
  canDockyardAction(actorId, dockyardId, "VIEW");
export const canManageDockyard = (actorId: string, dockyardId: string) =>
  canDockyardAction(actorId, dockyardId, "MANAGE_MEMBERS");
export const canUploadFile = (actorId: string, dockyardId: string) =>
  canDockyardAction(actorId, dockyardId, "UPLOAD_FILE");
export const canDownloadFile = (actorId: string, dockyardId: string) =>
  canDockyardAction(actorId, dockyardId, "DOWNLOAD_FILE");
export const canDeleteFile = (actorId: string, dockyardId: string) =>
  canDockyardAction(actorId, dockyardId, "DELETE_FILE");
export const canManageApiKeys = (actorId: string, dockyardId: string) =>
  canDockyardAction(actorId, dockyardId, "MANAGE_API_KEYS");

export async function listAccessibleDockyards(actorId: string, status?: DockStatus) {
  const context = await permissionService.getAuthorizationContext(actorId);
  const dockyards = await prisma.dockyards.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(!context.isSuperAdmin ? { members: { some: { userId: actorId } } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (context.isSuperAdmin && dockyards.length > 0) {
    await prisma.dockyardAuditEvent.createMany({
      data: dockyards.map(({ id }) => ({
        dockyardId: id,
        actorUserId: actorId,
        action: "SUPER_ADMIN_DOCKYARD_LIST",
        metadata: { accessMode: "global", resourceAuthorization: "bypass" },
      })),
    });
  }
  return dockyards;
}

type MutationStatus = "ok" | "notFound" | "forbidden" | "memberNotFound" | "lastAdmin";
export type MembershipMutation<T> = { status: MutationStatus; value?: T };

export async function lockDockyard(tx: Prisma.TransactionClient, dockyardId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Dockyards" WHERE "id" = ${dockyardId} FOR UPDATE
  `;
  return rows.length > 0;
}

async function authorizeMembershipMutation(
  tx: Prisma.TransactionClient,
  actorId: string,
  dockyardId: string,
  action: string,
) {
  const superAdmin = await tx.userRole.findFirst({
    where: { userId: actorId, role: { name: "Super Admin" } },
    select: { userId: true },
  });
  if (superAdmin) {
    await tx.dockyardAuditEvent.create({
      data: {
        dockyardId,
        actorUserId: actorId,
        action: `SUPER_ADMIN_DOCKYARD_${action}`,
        metadata: { accessMode: "global", resourceAuthorization: "bypass" },
      },
    });
    return true;
  }

  const actorMembership = await tx.dockyardMember.findUnique({
    where: { dockyardId_userId: { dockyardId, userId: actorId } },
    select: { role: true },
  });
  return actorMembership?.role === "ADMIN";
}

function mutationAuditAction(action: string) {
  return `DOCKYARD_MEMBER_${action}`;
}

export async function listDockyardMembers(actorId: string, dockyardId: string) {
  if (!(await canManageDockyard(actorId, dockyardId))) return null;
  return prisma.dockyardMember.findMany({
    where: { dockyardId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      userId: true,
      role: true,
      addedById: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function updateDockyardMemberRole(
  actorId: string,
  dockyardId: string,
  userId: string,
  role: DockyardMemberRole,
): Promise<MembershipMutation<unknown>> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockDockyard(tx, dockyardId))) return { status: "notFound" };
    if (!(await authorizeMembershipMutation(tx, actorId, dockyardId, "MEMBER_ROLE_CHANGE"))) return { status: "forbidden" };

    const current = await tx.dockyardMember.findUnique({ where: { dockyardId_userId: { dockyardId, userId } } });
    if (!current) return { status: "memberNotFound" };
    if (current.role === "ADMIN" && role !== "ADMIN") {
      const adminCount = await tx.dockyardMember.count({ where: { dockyardId, role: "ADMIN" } });
      if (adminCount <= 1) return { status: "lastAdmin" };
    }

    const member = await tx.dockyardMember.update({
      where: { dockyardId_userId: { dockyardId, userId } },
      data: { role },
      select: { userId: true, role: true, addedById: true, updatedAt: true },
    });
    await tx.dockyardAuditEvent.create({
      data: {
        dockyardId,
        actorUserId: actorId,
        targetUserId: userId,
        action: mutationAuditAction("ROLE_CHANGED"),
        metadata: { from: current.role, to: role },
      },
    });
    return { status: "ok", value: member };
  });
}

export async function removeDockyardMember(
  actorId: string,
  dockyardId: string,
  userId: string,
): Promise<MembershipMutation<undefined>> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockDockyard(tx, dockyardId))) return { status: "notFound" };
    if (!(await authorizeMembershipMutation(tx, actorId, dockyardId, "MEMBER_REMOVE"))) return { status: "forbidden" };

    const current = await tx.dockyardMember.findUnique({ where: { dockyardId_userId: { dockyardId, userId } } });
    if (!current) return { status: "memberNotFound" };
    if (current.role === "ADMIN") {
      const adminCount = await tx.dockyardMember.count({ where: { dockyardId, role: "ADMIN" } });
      if (adminCount <= 1) return { status: "lastAdmin" };
    }

    await tx.dockyardMember.delete({ where: { dockyardId_userId: { dockyardId, userId } } });
    await tx.dockyardAuditEvent.create({
      data: {
        dockyardId,
        actorUserId: actorId,
        targetUserId: userId,
        action: mutationAuditAction("REMOVED"),
        metadata: { previousRole: current.role },
      },
    });
    return { status: "ok" };
  });
}
