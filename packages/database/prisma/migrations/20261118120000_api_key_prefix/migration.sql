-- Public lookup prefixes are not credentials; legacy Api rows remain non-authenticating.
ALTER TABLE "Api" ADD COLUMN "keyPrefix" TEXT;
CREATE UNIQUE INDEX "Api_keyPrefix_key" ON "Api"("keyPrefix");
