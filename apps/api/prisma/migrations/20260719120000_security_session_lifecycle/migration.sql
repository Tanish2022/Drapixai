ALTER TABLE "User"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'brand_admin',
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ApiKey"
  ADD COLUMN "scopes" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

UPDATE "ApiKey"
SET "scopes" = CASE
  WHEN "kind" = 'shopify' THEN 'shopify:storefront'
  WHEN "kind" = 'manual' THEN 'storefront:tryon'
  ELSE 'dashboard'
END;

CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");
