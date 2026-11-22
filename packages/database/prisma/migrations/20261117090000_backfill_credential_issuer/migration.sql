-- Better Auth now qualifies local credential accounts with a synthetic issuer.
-- Backfill the nullable field for existing credentials so their login keeps working.
UPDATE "account"
SET "issuer" = 'local:credential'
WHERE "providerId" = 'credential'
  AND "issuer" IS NULL;
