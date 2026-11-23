BEGIN;

LOCK TABLE "user", "Dockyards", "DockyardMember" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Dockyards" d
    WHERE NOT EXISTS (
      SELECT 1 FROM "DockyardMember" m WHERE m."dockyardId" = d.id AND m.role = 'OWNER'
    )
  ) THEN
    RAISE EXCEPTION 'Resolve Dockyards without an OWNER before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "user" WHERE email IS NOT NULL
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve normalized email collisions before migration';
  END IF;
END $$;

ALTER TYPE "DockyardMemberRole" RENAME VALUE 'OWNER' TO 'ADMIN';
ALTER TABLE "user" ADD COLUMN "designation" TEXT;
CREATE UNIQUE INDEX "user_normalized_email_unique" ON "user" (lower(btrim(email)));

CREATE TABLE "UserCreationAudit" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "dockyardId" TEXT,
    "dockyardRole" "DockyardMemberRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCreationAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserCreationAudit_actorUserId_createdAt_idx" ON "UserCreationAudit" ("actorUserId", "createdAt");
CREATE INDEX "UserCreationAudit_targetUserId_idx" ON "UserCreationAudit" ("targetUserId");

COMMIT;
