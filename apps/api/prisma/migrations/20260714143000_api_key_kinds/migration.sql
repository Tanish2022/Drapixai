ALTER TABLE "ApiKey"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'dashboard',
  ADD COLUMN "label" TEXT;

UPDATE "ApiKey" AS key
SET "kind" = 'shopify'
FROM "ShopifyInstallation" AS installation
WHERE installation."storefrontApiKeyId" = key."id";

CREATE INDEX "ApiKey_userId_kind_isActive_idx" ON "ApiKey"("userId", "kind", "isActive");
