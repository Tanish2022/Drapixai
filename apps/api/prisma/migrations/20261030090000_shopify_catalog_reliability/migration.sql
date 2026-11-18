ALTER TABLE "ShopifyInstallation"
  ADD COLUMN "catalogEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "catalogRequestedVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "catalogSyncedVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "catalogNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "catalogSyncAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "catalogLeaseOwner" TEXT,
  ADD COLUMN "catalogLeaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "CatalogProduct" ADD COLUMN "preparedSourceHash" TEXT;
CREATE INDEX "ShopifyInstallation_status_catalogNextAttemptAt_idx" ON "ShopifyInstallation"("status", "catalogNextAttemptAt");

-- Existing active installations receive a durable initial reconciliation request.
UPDATE "ShopifyInstallation" SET "catalogRequestedVersion" = 1,
  "catalogNextAttemptAt" = CURRENT_TIMESTAMP WHERE "status" = 'active';

-- Drain old workers before rollout; old in-flight side effects have no ledger.
UPDATE "CatalogProduct" SET "preparationStatus" = 'reconciliation_required',
  "preparationError" = 'SHOPIFY_LEGACY_PREPARATION_RECONCILIATION_REQUIRED'
  WHERE "source" LIKE 'shopify:%' AND "preparationStatus" = 'processing';

CREATE TABLE "ShopifyPreparationJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "installationId" INTEGER NOT NULL,
  "catalogProductId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "epoch" INTEGER NOT NULL,
  "sourceImageUrl" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "garmentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "externalWorkStarted" BOOLEAN NOT NULL DEFAULT false,
  "aiRequestStarted" BOOLEAN NOT NULL DEFAULT false,
  "cacheKey" TEXT,
  "originalUrl" TEXT NOT NULL,
  "thumbnailUrl" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ShopifyPreparationJob_installationId_status_idx" ON "ShopifyPreparationJob"("installationId", "status");
CREATE INDEX "ShopifyPreparationJob_userId_status_idx" ON "ShopifyPreparationJob"("userId", "status");
CREATE INDEX "ShopifyPreparationJob_status_expiresAt_idx" ON "ShopifyPreparationJob"("status", "expiresAt");
