import { createHash } from "node:crypto";
import { Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { DockyardFile, Prisma } from "@repo/database";
import { prisma } from "@repo/database";
import { createStorageKey, inspectAllowedContent, normalizeFilename } from "../security/file-policy";
import { storage } from "../storage";
import { StorageObjectNotFoundError, StorageUnavailableError } from "../storage/provider";

let activeImageInspections = 0;
const inspectionQueue: Array<() => void> = [];

async function withImageInspection<T>(operation: () => Promise<T>): Promise<T> {
  if (activeImageInspections >= 2) await new Promise<void>((resolve) => inspectionQueue.push(resolve));
  activeImageInspections += 1;
  try {
    return await operation();
  } finally {
    activeImageInspections -= 1;
    inspectionQueue.shift()?.();
  }
}

async function inspectRasterImage(storageKey: string) {
  const source = await storage.readStagedStream(storageKey);
  const decoder = sharp({ limitInputPixels: 12_000_000, failOn: "error" });
  const discard = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  await withImageInspection(() => pipeline(source, decoder, discard));
}

export type FileAccessActor = { userId?: string; apiKeyId?: string };

export function publicFile(file: DockyardFile) {
  return {
    id: file.id,
    dockyardId: file.dockyardId,
    uploadedById: file.uploadedById,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes.toString(),
    sha256: file.sha256,
    state: file.state,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    deletedAt: file.deletedAt,
  };
}

async function auditFileEvent(
  tx: Prisma.TransactionClient,
  dockyardId: string,
  actor: FileAccessActor,
  action: string,
  metadata: Prisma.JsonObject,
) {
  await tx.dockyardAuditEvent.create({
    data: {
      dockyardId,
      actorUserId: actor.userId,
      action,
      metadata: { ...metadata, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authType: "api_key" } : actor.userId ? { authType: "session" } : {}) },
    },
  });
}

export async function auditFileAccessDenied(dockyardId: string, actor: FileAccessActor, action: string, fileId?: string) {
  if (!(await prisma.dockyards.findUnique({ where: { id: dockyardId }, select: { id: true } }))) return;
  await prisma.dockyardAuditEvent.create({
    data: {
      dockyardId,
      actorUserId: actor.userId,
      action: "FILE_AUTHORIZATION_DENIED",
      metadata: { requestedAction: action, ...(fileId ? { fileId } : {}), ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}) },
    },
  });
}

type UploadFailureCode = "invalid_filename" | "unsupported_content" | "empty_file" | "too_large" | "storage_unavailable" | "database_unavailable" | "interrupted";
export type UploadResult = { ok: true; file: ReturnType<typeof publicFile> } | { ok: false; code: UploadFailureCode; message: string; fileId?: string };

function uploadFailureCode(error: unknown): UploadFailureCode {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "FILE_TOO_LARGE" || code === "FST_REQ_FILE_TOO_LARGE") return "too_large";
  if (error instanceof StorageUnavailableError) return "storage_unavailable";
  if (error instanceof StorageObjectNotFoundError) return "storage_unavailable";
  if (code === "INVALID_FILENAME") return "invalid_filename";
  if (code === "UNSUPPORTED_CONTENT") return "unsupported_content";
  if (code === "EMPTY_FILE") return "empty_file";
  if (code === "ECONNRESET" || code === "ABORT_ERR") return "interrupted";
  return "storage_unavailable";
}

function customError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export async function uploadFile(input: {
  dockyardId: string;
  uploadedById?: string;
  actor: FileAccessActor;
  filename: string;
  source: Readable;
  maxBytes: number;
}): Promise<UploadResult> {
  let originalName: string;
  try {
    originalName = normalizeFilename(input.filename);
  } catch {
    input.source.destroy();
    return { ok: false, code: "invalid_filename", message: "Invalid filename" };
  }

  const storageKey = createStorageKey();
  let file: DockyardFile;
  try {
    file = await prisma.dockyardFile.create({
      data: {
        dockyardId: input.dockyardId,
        uploadedById: input.uploadedById,
        storageKey,
        originalName,
        contentType: "application/octet-stream",
        sizeBytes: 0n,
        state: "STAGED",
      },
    });
  } catch {
    input.source.destroy();
    return { ok: false, code: "database_unavailable", message: "Could not create file metadata" };
  }

  let finalized = false;
  try {
    const result = await storage.writeStream(storageKey, input.source, input.maxBytes);
    if ((input.source as Readable & { truncated?: boolean }).truncated) throw customError("FILE_TOO_LARGE", "Multipart file exceeded the configured size limit");
    if (result.sizeBytes === 0) throw customError("EMPTY_FILE", "Empty files are not accepted");
    const contentType = inspectAllowedContent(result.header, originalName);
    if (!contentType) throw customError("UNSUPPORTED_CONTENT", "File type is not allowed or does not match its content");
    try {
      await inspectRasterImage(storageKey);
    } catch {
      throw customError("UNSUPPORTED_CONTENT", "Image content is malformed or exceeds inspection limits");
    }

    await prisma.dockyardFile.update({
      where: { id: file.id },
      data: { contentType, sizeBytes: BigInt(result.sizeBytes), sha256: result.sha256 },
    });
    await storage.finalize(storageKey);
    finalized = true;
    const available = await prisma.$transaction(async (tx) => {
      const updated = await tx.dockyardFile.update({ where: { id: file.id }, data: { state: "AVAILABLE" } });
      await auditFileEvent(tx, input.dockyardId, input.actor, "FILE_UPLOAD", { fileId: file.id, sizeBytes: result.sizeBytes, contentType });
      return updated;
    });
    return { ok: true, file: publicFile(available) };
  } catch (error) {
    const code = uploadFailureCode(error);
    await (finalized ? storage.delete(storageKey) : storage.removeStaged(storageKey)).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      await tx.dockyardFile.update({ where: { id: file.id }, data: { state: "FAILED" } });
      await auditFileEvent(tx, input.dockyardId, input.actor, "FILE_UPLOAD_FAILED", { fileId: file.id, reason: code });
    }).catch(() => undefined);
    const message = code === "too_large" ? "File exceeds the configured size limit" : code === "unsupported_content" ? "File type is not allowed or does not match its content" : code === "empty_file" ? "Empty files are not accepted" : code === "invalid_filename" ? "Invalid filename" : code === "database_unavailable" ? "Database is unavailable" : code === "interrupted" ? "Upload was interrupted" : "File storage is unavailable";
    return { ok: false, code, message, fileId: file.id };
  }
}

export async function listFiles(dockyardId: string, page: number, limit: number) {
  const [rows, total] = await prisma.$transaction([
    prisma.dockyardFile.findMany({
      where: { dockyardId, state: { not: "DELETED" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.dockyardFile.count({ where: { dockyardId, state: { not: "DELETED" } } }),
  ]);
  return { files: rows.map(publicFile), page, limit, total };
}

export function getFile(dockyardId: string, fileId: string) {
  return prisma.dockyardFile.findFirst({ where: { id: fileId, dockyardId, state: { not: "DELETED" } } });
}

export async function getAvailableFile(dockyardId: string, fileId: string) {
  const file = await getFile(dockyardId, fileId);
  return file?.state === "AVAILABLE" ? file : null;
}

export async function verifyFile(dockyardId: string, fileId: string, actor: FileAccessActor) {
  const file = await getAvailableFile(dockyardId, fileId);
  if (!file || !file.sha256) return null;
  const stream = await storage.readStream(file.storageKey);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    sizeBytes += buffer.length;
  }
  const actual = hash.digest("hex");
  const matches = actual === file.sha256 && BigInt(sizeBytes) === file.sizeBytes;
  await prisma.$transaction(async (tx) => {
    if (!matches) await tx.dockyardFile.update({ where: { id: file.id }, data: { state: "QUARANTINED" } });
    await auditFileEvent(tx, dockyardId, actor, "FILE_VERIFIED", { fileId, matches, ...(!matches ? { actualSha256: actual } : {}), sizeBytes });
  });
  return { fileId, expectedSha256: file.sha256, actualSha256: actual, matches, sizeBytes };
}

export async function deleteFile(dockyardId: string, fileId: string, actor: FileAccessActor) {
  const file = await prisma.dockyardFile.findFirst({ where: { id: fileId, dockyardId } });
  if (!file) return "notFound" as const;
  if (file.state === "DELETED") return "ok" as const;
  if (file.state !== "DELETING") {
    await prisma.$transaction(async (tx) => {
      await tx.dockyardFile.update({ where: { id: file.id }, data: { state: "DELETING" } });
      await auditFileEvent(tx, dockyardId, actor, "FILE_DELETE_STARTED", { fileId });
    });
  }
  await storage.delete(file.storageKey);
  await prisma.$transaction(async (tx) => {
    await tx.dockyardFile.update({ where: { id: file.id }, data: { state: "DELETED", deletedAt: new Date() } });
    await auditFileEvent(tx, dockyardId, actor, "FILE_DELETED", { fileId });
  });
  return "ok" as const;
}

export async function auditFileDownload(dockyardId: string, fileId: string, actor: FileAccessActor, authType?: string) {
  await prisma.dockyardAuditEvent.create({
    data: {
      dockyardId,
      actorUserId: actor.userId,
      action: "FILE_DOWNLOAD",
      metadata: { fileId, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}), ...(authType ? { authType } : actor.userId ? { authType: "session" } : {}) },
    },
  });
}

export async function auditSignedUrlCreation(dockyardId: string, fileId: string, actor: FileAccessActor, expiresAt: number) {
  await prisma.dockyardAuditEvent.create({
    data: {
      dockyardId,
      actorUserId: actor.userId,
      action: "FILE_SIGNED_URL_CREATED",
      metadata: { fileId, expiresAt, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : actor.userId ? { authType: "session" } : {}) },
    },
  });
}

export async function reconcileFiles() {
  const stale = await prisma.dockyardFile.findMany({ where: { state: { in: ["STAGED", "DELETING"] } } });
  const result = { finalized: 0, deleted: 0, failed: 0, orphanStagesRemoved: 0 };
  const trackedStageKeys = new Set(stale.filter((file) => file.state === "STAGED").map((file) => file.storageKey));

  for (const file of stale) {
    if (file.state === "STAGED") {
      try {
        if (!file.sha256 || file.sizeBytes <= 0n) {
          await storage.removeStaged(file.storageKey);
          await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "FAILED" } });
          result.failed += 1;
          continue;
        }
        let objectExists = await storage.exists(file.storageKey);
        if (objectExists) {
          const stat = await storage.stat?.(file.storageKey);
          if (stat && BigInt(stat.sizeBytes) !== file.sizeBytes) throw new Error("Object size does not match metadata");
        } else if (await storage.hasStaged?.(file.storageKey)) {
          const stagedHash = createHash("sha256");
          let stagedSize = 0n;
          for await (const chunk of await storage.readStagedStream(file.storageKey)) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            stagedHash.update(buffer);
            stagedSize += BigInt(buffer.length);
          }
          if (stagedHash.digest("hex") !== file.sha256 || stagedSize !== file.sizeBytes) {
            await storage.removeStaged(file.storageKey);
            await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "QUARANTINED" } });
            result.failed += 1;
            continue;
          }
          await storage.finalize(file.storageKey);
          objectExists = true;
        } else {
          await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "FAILED" } });
          result.failed += 1;
          continue;
        }
        if (objectExists) {
          const objectHash = createHash("sha256");
          let objectSize = 0n;
          for await (const chunk of await storage.readStream(file.storageKey)) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            objectHash.update(buffer);
            objectSize += BigInt(buffer.length);
          }
          if (objectHash.digest("hex") !== file.sha256 || objectSize !== file.sizeBytes) {
            await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "QUARANTINED" } });
            result.failed += 1;
            continue;
          }
        }
        await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "AVAILABLE" } });
        result.finalized += 1;
      } catch {
        result.failed += 1;
      }
    } else {
      try {
        await storage.delete(file.storageKey);
        await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "DELETED", deletedAt: file.deletedAt ?? new Date() } });
        result.deleted += 1;
      } catch {
        // Keep DELETING for the next explicit reconciliation run.
      }
    }
  }

  for (const storageKey of await storage.listStagedKeys?.() ?? []) {
    if (!trackedStageKeys.has(storageKey)) {
      await storage.removeStaged?.(storageKey);
      result.orphanStagesRemoved += 1;
    }
  }
  return result;
}
