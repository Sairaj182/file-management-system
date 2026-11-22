CREATE TYPE "DockyardMemberRole" AS ENUM ('OWNER', 'MANAGER', 'VIEWER');
CREATE TYPE "ApiKeyScope" AS ENUM ('FILE_READ', 'FILE_WRITE', 'FILE_DELETE');
CREATE TYPE "FileLifecycleState" AS ENUM ('STAGED', 'AVAILABLE', 'DELETING', 'DELETED', 'FAILED');

ALTER TABLE "Api"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "keyDigest" TEXT,
  ADD COLUMN "scopes" "ApiKeyScope"[] NOT NULL DEFAULT ARRAY[]::"ApiKeyScope"[],
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3);

CREATE TABLE "DockyardMember" (
  "id" TEXT NOT NULL,
  "dockyardId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "DockyardMemberRole" NOT NULL,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DockyardMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DockyardFile" (
  "id" TEXT NOT NULL,
  "dockyardId" TEXT NOT NULL,
  "uploadedById" TEXT,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT,
  "state" "FileLifecycleState" NOT NULL DEFAULT 'STAGED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DockyardFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DockyardAuditEvent" (
  "id" TEXT NOT NULL,
  "dockyardId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DockyardAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Api_keyDigest_key" ON "Api"("keyDigest");
CREATE INDEX "Api_dockId_revokedAt_idx" ON "Api"("dockId", "revokedAt");
CREATE INDEX "Api_expiresAt_idx" ON "Api"("expiresAt");
CREATE UNIQUE INDEX "DockyardMember_dockyardId_userId_key" ON "DockyardMember"("dockyardId", "userId");
CREATE INDEX "DockyardMember_userId_dockyardId_idx" ON "DockyardMember"("userId", "dockyardId");
CREATE INDEX "DockyardMember_dockyardId_role_idx" ON "DockyardMember"("dockyardId", "role");
CREATE UNIQUE INDEX "DockyardFile_storageKey_key" ON "DockyardFile"("storageKey");
CREATE INDEX "DockyardFile_dockyardId_state_createdAt_idx" ON "DockyardFile"("dockyardId", "state", "createdAt");
CREATE INDEX "DockyardFile_uploadedById_idx" ON "DockyardFile"("uploadedById");
CREATE INDEX "DockyardAuditEvent_dockyardId_createdAt_idx" ON "DockyardAuditEvent"("dockyardId", "createdAt");
CREATE INDEX "DockyardAuditEvent_actorUserId_createdAt_idx" ON "DockyardAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "DockyardAuditEvent_targetUserId_idx" ON "DockyardAuditEvent"("targetUserId");

ALTER TABLE "DockyardMember"
  ADD CONSTRAINT "DockyardMember_dockyardId_fkey" FOREIGN KEY ("dockyardId") REFERENCES "Dockyards"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DockyardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DockyardMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DockyardFile"
  ADD CONSTRAINT "DockyardFile_dockyardId_fkey" FOREIGN KEY ("dockyardId") REFERENCES "Dockyards"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DockyardFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DockyardAuditEvent"
  ADD CONSTRAINT "DockyardAuditEvent_dockyardId_fkey" FOREIGN KEY ("dockyardId") REFERENCES "Dockyards"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DockyardAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DockyardAuditEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve every existing Dockyard and grant initial ownership to its creator.
INSERT INTO "DockyardMember" ("id", "dockyardId", "userId", "role", "addedById", "createdAt", "updatedAt")
SELECT 'dockyard_owner_' || md5(d."id"), d."id", d."createdById", 'OWNER', d."createdById", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Dockyards" AS d
ON CONFLICT ("dockyardId", "userId") DO NOTHING;
