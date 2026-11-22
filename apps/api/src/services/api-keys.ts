import type { ApiKeyScope, Prisma } from "@repo/database";
import { prisma } from "@repo/database";
import { permissionService } from "../rbac";
import { createApiKeyMaterial, toDatabaseScopes } from "../security/api-key";
import type { ExternalApiKeyScope } from "../security/api-key";
import { hasDockyardCapability } from "../security/dockyard-policy";

type Tx = Prisma.TransactionClient;
const selectKey = {
  id: true, dockId: true, createdById: true, name: true, keyPrefix: true,
  keyDigest: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true,
} as const;

export function publicApiKey(key: any) {
  const expiresAt = key.expiresAt as Date | null;
  return {
    id: key.id,
    dockyardId: key.dockId,
    createdById: key.createdById,
    name: key.name,
    prefix: key.keyPrefix ? `vfs_live_${key.keyPrefix}_…` : null,
    scopes: (key.scopes as ApiKeyScope[]).map((scope) => ({ FILE_READ: "READ", FILE_WRITE: "WRITE", FILE_DELETE: "DELETE" } as const)[scope]),
    createdAt: key.createdAt,
    expiresAt,
    revokedAt: key.revokedAt,
    lastUsedAt: key.lastUsedAt,
    active: Boolean(key.keyDigest && !key.revokedAt && (!expiresAt || expiresAt > new Date())),
  };
}

async function lockDockyard(tx: Tx, dockyardId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Dockyards" WHERE "id" = ${dockyardId} FOR UPDATE`;
  return rows.length > 0;
}

async function authorizeManage(tx: Tx, actorId: string, dockyardId: string, action: string) {
  const superAdmin = await tx.userRole.findFirst({
    where: { userId: actorId, role: { name: "Super Admin" } }, select: { userId: true },
  });
  if (superAdmin) {
    await tx.dockyardAuditEvent.create({
      data: { dockyardId, actorUserId: actorId, action: `SUPER_ADMIN_API_KEY_${action}`, metadata: { accessMode: "global", resourceAuthorization: "bypass" } },
    });
    return true;
  }
  const member = await tx.dockyardMember.findUnique({ where: { dockyardId_userId: { dockyardId, userId: actorId } }, select: { role: true } });
  return Boolean(member && hasDockyardCapability(member.role, "MANAGE_API_KEYS"));
}

async function requireManager(actorId: string, dockyardId: string, action: string) {
  if (!(await prisma.dockyards.findUnique({ where: { id: dockyardId }, select: { id: true } }))) return false;
  const context = await permissionService.getAuthorizationContext(actorId);
  if (!context.isSuperAdmin) {
    const member = await prisma.dockyardMember.findUnique({ where: { dockyardId_userId: { dockyardId, userId: actorId } }, select: { role: true } });
    return Boolean(member && hasDockyardCapability(member.role, "MANAGE_API_KEYS"));
  }
  await prisma.dockyardAuditEvent.create({ data: { dockyardId, actorUserId: actorId, action: `SUPER_ADMIN_API_KEY_${action}`, metadata: { accessMode: "global", resourceAuthorization: "bypass" } } });
  return true;
}

export async function listApiKeys(actorId: string, dockyardId: string) {
  if (!(await requireManager(actorId, dockyardId, "LIST"))) return null;
  const rows = await prisma.api.findMany({ where: { dockId: dockyardId }, orderBy: { createdAt: "desc" }, select: selectKey });
  return rows.map(publicApiKey);
}

export async function getApiKey(actorId: string, dockyardId: string, keyId: string) {
  if (!(await requireManager(actorId, dockyardId, "READ"))) return null;
  const key = await prisma.api.findFirst({ where: { id: keyId, dockId: dockyardId }, select: selectKey });
  return key ? publicApiKey(key) : null;
}

type KeyMutation = { status: "ok"; metadata: ReturnType<typeof publicApiKey>; secret?: string } | { status: "notFound" | "forbidden" | "legacy" };
export async function createApiKey(actorId: string, dockyardId: string, input: { name?: string; scopes: ExternalApiKeyScope[]; expiresAt?: Date | null }): Promise<KeyMutation> {
  const material = createApiKeyMaterial();
  return prisma.$transaction(async (tx) => {
    if (!(await lockDockyard(tx, dockyardId))) return { status: "notFound" };
    if (!(await authorizeManage(tx, actorId, dockyardId, "CREATED"))) return { status: "forbidden" };
    const row = await tx.api.create({ data: { dockId: dockyardId, createdById: actorId, name: input.name, keyPrefix: material.keyPrefix, keyDigest: material.keyDigest, scopes: toDatabaseScopes(input.scopes), expiresAt: input.expiresAt ?? null }, select: { ...selectKey, keyDigest: true } });
    await tx.dockyardAuditEvent.create({ data: { dockyardId, actorUserId: actorId, action: "API_KEY_CREATED", metadata: { apiKeyId: row.id, scopes: input.scopes, expiresAt: row.expiresAt } } });
    return { status: "ok", metadata: publicApiKey(row), secret: material.secret };
  });
}

export async function rotateApiKey(actorId: string, dockyardId: string, keyId: string, input: { expiresAt?: Date | null }): Promise<KeyMutation> {
  const material = createApiKeyMaterial();
  return prisma.$transaction(async (tx) => {
    if (!(await lockDockyard(tx, dockyardId))) return { status: "notFound" };
    if (!(await authorizeManage(tx, actorId, dockyardId, "ROTATE"))) return { status: "forbidden" };
    const old = await tx.api.findFirst({ where: { id: keyId, dockId: dockyardId }, select: { ...selectKey, keyDigest: true } });
    if (!old) return { status: "notFound" };
    if (!old.keyDigest || !old.keyPrefix) return { status: "legacy" };
    if (old.revokedAt || (old.expiresAt && old.expiresAt <= new Date())) return { status: "notFound" };
    const revokedAt = new Date();
    await tx.api.update({ where: { id: old.id }, data: { revokedAt } });
    const expiresAt = input.expiresAt === undefined ? (old.expiresAt && old.expiresAt > new Date() ? old.expiresAt : null) : input.expiresAt;
    const row = await tx.api.create({ data: { dockId: dockyardId, createdById: actorId, name: old.name, keyPrefix: material.keyPrefix, keyDigest: material.keyDigest, scopes: old.scopes, expiresAt }, select: { ...selectKey, keyDigest: true } });
    await tx.dockyardAuditEvent.create({ data: { dockyardId, actorUserId: actorId, action: "API_KEY_ROTATED", metadata: { oldApiKeyId: old.id, apiKeyId: row.id, scopes: row.scopes } } });
    return { status: "ok", metadata: publicApiKey(row), secret: material.secret };
  });
}

export async function revokeApiKey(actorId: string, dockyardId: string, keyId: string) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockDockyard(tx, dockyardId))) return "notFound" as const;
    if (!(await authorizeManage(tx, actorId, dockyardId, "REVOKE"))) return "forbidden" as const;
    const row = await tx.api.findFirst({ where: { id: keyId, dockId: dockyardId }, select: { id: true, revokedAt: true } });
    if (!row) return "notFound" as const;
    if (!row.revokedAt) await tx.api.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    await tx.dockyardAuditEvent.create({ data: { dockyardId, actorUserId: actorId, action: "API_KEY_REVOKED", metadata: { apiKeyId: keyId, alreadyRevoked: Boolean(row.revokedAt) } } });
    return "ok" as const;
  });
}
