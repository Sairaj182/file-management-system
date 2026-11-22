import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { prisma } from "@repo/database";
import { requireAuth } from "../middleware/auth";
import { requireApiKey } from "../middleware/api-key-auth";
import { env } from "../env";
import { canDeleteFile, canDownloadFile, canUploadFile, canViewDockyard } from "../services/dockyard-access";
import {
  auditFileAccessDenied,
  auditFileDownload,
  auditSignedUrlCreation,
  deleteFile,
  getAvailableFile,
  getFile,
  listFiles,
  publicFile,
  uploadFile,
  verifyFile,
  type FileAccessActor,
} from "../services/files";
import { createSignedFileToken, verifySignedFileToken } from "../security/file-policy";
import { StorageObjectNotFoundError, StorageUnavailableError, storage } from "../storage";

type FileAction = "LIST" | "UPLOAD" | "DOWNLOAD" | "DELETE";

function dockyardIdFrom(request: FastifyRequest) {
  return (request.params as { dockyardId?: string }).dockyardId ?? "";
}

function actorFrom(request: FastifyRequest): FileAccessActor {
  if (request.apiKeyAuth) return { apiKeyId: request.apiKeyAuth.keyId };
  const userId = (request as any).user?.id;
  return typeof userId === "string" ? { userId } : {};
}

function fileAccess(action: FileAction): preHandlerHookHandler {
  const scope = action === "UPLOAD" ? "WRITE" : action === "DELETE" ? "DELETE" : "READ";
  const apiKeyGuard = requireApiKey({ requiredScopes: [scope], requestedDockyardId: dockyardIdFrom });
  return async (request, reply) => {
    const dockyardId = dockyardIdFrom(request);
    if (request.headers["x-api-key"] !== undefined) {
      await apiKeyGuard.call(request.server, request, reply, () => undefined);
      return;
    }

    await requireAuth(request, reply);
    if (reply.sent) return;
    const userId = (request as any).user.id as string;
    const allowed = action === "UPLOAD"
      ? await canUploadFile(userId, dockyardId)
      : action === "DELETE"
        ? await canDeleteFile(userId, dockyardId)
        : action === "DOWNLOAD"
          ? await canDownloadFile(userId, dockyardId)
          : await canViewDockyard(userId, dockyardId);
    if (!allowed) {
      await auditFileAccessDenied(dockyardId, { userId }, action);
      return reply.status(404).send({ error: "Dockyard not found" });
    }
    const dockyard = await prisma.dockyards.findUnique({ where: { id: dockyardId }, select: { status: true } });
    if (!dockyard || dockyard.status !== "ACTIVE") {
      await auditFileAccessDenied(dockyardId, { userId }, action);
      return reply.status(dockyard ? 403 : 404).send({ error: "Dockyard is not available" });
    }
  };
}

function sendStorageError(reply: FastifyReply, error: unknown) {
  if (error instanceof StorageObjectNotFoundError) return reply.status(404).send({ error: "File content not found" });
  if (error instanceof StorageUnavailableError) return reply.status(503).send({ error: "File storage is unavailable" });
  return reply.status(503).send({ error: "File operation is unavailable" });
}

async function streamFile(dockyardId: string, fileId: string, actor: FileAccessActor, reply: FastifyReply, authType?: string) {
  const file = await getAvailableFile(dockyardId, fileId);
  if (!file) return reply.status(404).send({ error: "File not found or unavailable" });
  const stream = await storage.readStream(file.storageKey);
  await auditFileDownload(dockyardId, file.id, actor, authType);
  reply
    .header("Content-Type", file.contentType)
    .header("Content-Length", file.sizeBytes.toString())
    .header("Content-Disposition", attachmentName(file.originalName))
    .header("X-Content-Type-Options", "nosniff")
    .header("Cache-Control", "private, no-store");
  return reply.send(stream);
}

function attachmentName(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.post("/:dockyardId/files", {
    preHandler: [fileAccess("UPLOAD")],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!request.isMultipart()) return reply.status(415).send({ error: "Expected multipart/form-data" });
    const dockyardId = dockyardIdFrom(request);
    const actor = actorFrom(request);
    const results: Array<{ ok: boolean; file?: ReturnType<typeof publicFile>; filename?: string; error?: string; code?: string }> = [];
    let fileCount = 0;
    let parserLimitExceeded = false;
    try {
      for await (const part of request.parts()) {
        if (part.type !== "file") continue;
        fileCount += 1;
        if (fileCount > env.FILE_MAX_COUNT) {
          part.file.resume();
          results.push({ ok: false, filename: part.filename, code: "too_many_files", error: `At most ${env.FILE_MAX_COUNT} files may be uploaded per request` });
          continue;
        }
        const result = await uploadFile({
          dockyardId,
          uploadedById: actor.userId,
          actor,
          filename: part.filename,
          source: part.file,
          maxBytes: env.FILE_MAX_SIZE_BYTES,
        });
        if (result.ok) results.push({ ok: true, file: result.file, filename: result.file.originalName });
        else results.push({ ok: false, filename: part.filename, code: result.code, error: result.message, ...(result.fileId ? { fileId: result.fileId } : {}) });
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      parserLimitExceeded = code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT";
      request.log.warn({ event: "multipart_upload_interrupted", dockyardId }, "Multipart upload did not complete");
      results.push({ ok: false, code: parserLimitExceeded ? "too_large" : "multipart_error", error: parserLimitExceeded ? "Multipart request exceeded its configured limit" : "Multipart request could not be completed" });
    }
    if (fileCount === 0) return reply.status(400).send({ error: "At least one file is required" });
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    const response = { success: failed === 0, data: results.filter((result) => result.ok).map((result) => result.file), errors: results.filter((result) => !result.ok) };
    if (failed === 0) return reply.status(201).send(response);
    if (succeeded > 0) return reply.status(207).send(response);
    if (parserLimitExceeded || results.some((result) => result.code === "too_large" || result.code === "too_many_files")) return reply.status(413).send(response);
    const unavailable = results.some((result) => result.code === "storage_unavailable" || result.code === "database_unavailable");
    return reply.status(unavailable ? 503 : 422).send(response);
  });

  app.get("/:dockyardId/files", {
    preHandler: [fileAccess("LIST")],
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const parsed = pageSchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send({ success: true, data: await listFiles(dockyardIdFrom(request), parsed.data.page, parsed.data.limit) });
    } catch {
      return reply.status(503).send({ error: "File metadata is unavailable" });
    }
  });

  app.get("/:dockyardId/files/:fileId", {
    preHandler: [fileAccess("LIST")],
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    try {
      const file = await getFile(dockyardIdFrom(request), fileId);
      if (!file) return reply.status(404).send({ error: "File not found" });
      return reply.send({ success: true, data: publicFile(file) });
    } catch {
      return reply.status(503).send({ error: "File metadata is unavailable" });
    }
  });

  app.get("/:dockyardId/files/:fileId/download", {
    preHandler: [fileAccess("DOWNLOAD")],
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    try {
      return await streamFile(dockyardIdFrom(request), fileId, actorFrom(request), reply);
    } catch (error) {
      request.log.warn({ event: "file_download_failed", fileId }, "File download failed");
      return sendStorageError(reply, error);
    }
  });

  app.delete("/:dockyardId/files/:fileId", {
    preHandler: [fileAccess("DELETE")],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    try {
      const result = await deleteFile(dockyardIdFrom(request), fileId, actorFrom(request));
      if (result === "notFound") return reply.status(404).send({ error: "File not found" });
      return reply.status(204).send();
    } catch (error) {
      request.log.warn({ event: "file_delete_incomplete", fileId }, "File deletion needs reconciliation");
      return sendStorageError(reply, error);
    }
  });

  app.post("/:dockyardId/files/:fileId/verify", {
    preHandler: [fileAccess("LIST")],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    try {
      const result = await verifyFile(dockyardIdFrom(request), fileId, actorFrom(request));
      if (!result) return reply.status(404).send({ error: "File not found or unavailable" });
      return reply.send({ success: true, data: result });
    } catch (error) {
      request.log.warn({ event: "file_verification_failed", fileId }, "File verification failed");
      return sendStorageError(reply, error);
    }
  });

  app.post("/:dockyardId/files/:fileId/signed-url", {
    preHandler: [fileAccess("DOWNLOAD")],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = z.object({ expiresInSeconds: z.coerce.number().int().min(1).max(env.FILE_SIGNED_URL_MAX_TTL_SECONDS).default(60) }).safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const { fileId } = request.params as { fileId: string };
    const dockyardId = dockyardIdFrom(request);
    const file = await getAvailableFile(dockyardId, fileId);
    if (!file) return reply.status(404).send({ error: "File not found or unavailable" });
    const expiresAt = Math.floor(Date.now() / 1000) + body.data.expiresInSeconds;
    const token = createSignedFileToken({ dockyardId, fileId, expiresAt }, env.FILE_SIGNING_SECRET);
    await auditSignedUrlCreation(dockyardId, fileId, actorFrom(request), expiresAt);
    const url = new URL(`/api/files/signed/${token}`, env.FILE_PUBLIC_BASE_URL).toString();
    return reply.send({ success: true, data: { url, expiresAt: new Date(expiresAt * 1000).toISOString() } });
  });

};

export const signedFileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/signed/:token", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const claims = verifySignedFileToken(token, env.FILE_SIGNING_SECRET, undefined, env.FILE_SIGNED_URL_MAX_TTL_SECONDS);
    if (!claims) return reply.status(401).send({ error: "Signed URL is invalid or expired" });
    try {
      const dockyard = await prisma.dockyards.findUnique({ where: { id: claims.dockyardId }, select: { status: true } });
      if (!dockyard || dockyard.status !== "ACTIVE") return reply.status(404).send({ error: "File not found or unavailable" });
      return await streamFile(claims.dockyardId, claims.fileId, {}, reply, "signed_url");
    } catch (error) {
      request.log.warn({ event: "signed_file_download_failed" }, "Signed file download failed");
      return sendStorageError(reply, error);
    }
  });
};
