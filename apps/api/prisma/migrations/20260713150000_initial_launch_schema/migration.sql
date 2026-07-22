-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "companyName" TEXT,
    "mobileNumber" TEXT,
    "themePreference" TEXT NOT NULL DEFAULT 'dark',
    "storeVerificationToken" TEXT,
    "storeVerifiedAt" TIMESTAMP(3),
    "catalogSyncSource" TEXT,
    "catalogFeedUrl" TEXT,
    "catalogLastSyncedAt" TIMESTAMP(3),
    "catalogLastSyncStatus" TEXT,
    "planType" TEXT NOT NULL DEFAULT 'trial',
    "selectedPlan" TEXT,
    "subscriptionPlan" TEXT,
    "subscriptionStatus" TEXT,
    "subscriptionProvider" TEXT,
    "subscriptionCustomerId" TEXT,
    "subscriptionId" TEXT,
    "subscriptionCurrentPeriodEndsAt" TIMESTAMP(3),
    "trialExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "domainWhitelist" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" SERIAL NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "renderCount" INTEGER NOT NULL DEFAULT 0,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageDaily" (
    "id" SERIAL NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Render" (
    "id" SERIAL NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "inputUrl" TEXT,
    "outputUrl" TEXT,
    "productId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Render_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TryOnResult" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "apiKeyId" INTEGER,
    "requestId" TEXT,
    "garmentId" TEXT,
    "productId" TEXT,
    "personImageUrl" TEXT,
    "garmentImageUrl" TEXT,
    "resultImageUrl" TEXT,
    "engine" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "candidateCount" INTEGER NOT NULL DEFAULT 1,
    "candidateScores" JSONB,
    "timingJson" JSONB,
    "processingMs" INTEGER,
    "latencyMs" INTEGER,
    "warnings" JSONB,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TryOnFeedback" (
    "id" SERIAL NOT NULL,
    "tryOnResultId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "looksReal" BOOLEAN,
    "bodyChanged" BOOLEAN NOT NULL DEFAULT false,
    "garmentChanged" BOOLEAN NOT NULL DEFAULT false,
    "faceChanged" BOOLEAN NOT NULL DEFAULT false,
    "badHands" BOOLEAN NOT NULL DEFAULT false,
    "badNeck" BOOLEAN NOT NULL DEFAULT false,
    "badSleeves" BOOLEAN NOT NULL DEFAULT false,
    "regenerateReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Garment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "garmentId" TEXT NOT NULL,
    "displayName" TEXT,
    "cacheKey" TEXT,
    "originalHash" TEXT NOT NULL,
    "originalUrl" TEXT,
    "sourceImageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "productName" TEXT,
    "category" TEXT,
    "garmentType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'missing',
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Garment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "parentProductId" TEXT,
    "isVariant" BOOLEAN NOT NULL DEFAULT false,
    "productName" TEXT,
    "category" TEXT,
    "garmentType" TEXT,
    "imageUrl" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "preparationStatus" TEXT NOT NULL DEFAULT 'not_queued',
    "preparationAttempts" INTEGER NOT NULL DEFAULT 0,
    "preparationError" TEXT,
    "preparationWarnings" JSONB,
    "preparationQueuedAt" TIMESTAMP(3),
    "preparationStartedAt" TIMESTAMP(3),
    "preparationNextAttemptAt" TIMESTAMP(3),
    "preparationCompletedAt" TIMESTAMP(3),
    "preparedImageUrl" TEXT,
    "preparedGarmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyInstallation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "shopDomain" TEXT NOT NULL,
    "shopName" TEXT,
    "primaryDomain" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedStorefrontKey" TEXT,
    "storefrontApiKeyId" INTEGER,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_link',
    "linkTokenHash" TEXT,
    "linkTokenExpiresAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedAt" TIMESTAMP(3),
    "uninstalledAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifySyncRun" (
    "id" SERIAL NOT NULL,
    "installationId" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "productsSeen" INTEGER NOT NULL DEFAULT 0,
    "productsReady" INTEGER NOT NULL DEFAULT 0,
    "productsSkipped" INTEGER NOT NULL DEFAULT 0,
    "productsQueued" INTEGER NOT NULL DEFAULT 0,
    "productsPrepared" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ShopifySyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyWebhookEvent" (
    "id" SERIAL NOT NULL,
    "webhookId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ShopifyWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogPreparationLease" (
    "id" TEXT NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogPreparationLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarmentMatch" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "garmentId" TEXT NOT NULL,
    "suggestedProductId" TEXT,
    "confirmedProductId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "confidence" DOUBLE PRECISION,
    "matchReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarmentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteEvent" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "path" TEXT,
    "visitorId" TEXT,
    "referrer" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Usage_apiKeyId_month_year_key" ON "Usage"("apiKeyId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "UsageDaily_apiKeyId_date_key" ON "UsageDaily"("apiKeyId", "date");

-- CreateIndex
CREATE INDEX "TryOnResult_userId_createdAt_idx" ON "TryOnResult"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TryOnResult_engine_createdAt_idx" ON "TryOnResult"("engine", "createdAt");

-- CreateIndex
CREATE INDEX "TryOnResult_status_createdAt_idx" ON "TryOnResult"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TryOnFeedback_tryOnResultId_idx" ON "TryOnFeedback"("tryOnResultId");

-- CreateIndex
CREATE INDEX "TryOnFeedback_userId_createdAt_idx" ON "TryOnFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Garment_userId_idx" ON "Garment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Garment_userId_garmentId_key" ON "Garment"("userId", "garmentId");

-- CreateIndex
CREATE INDEX "CatalogProduct_userId_idx" ON "CatalogProduct"("userId");

-- CreateIndex
CREATE INDEX "CatalogProduct_userId_preparationStatus_idx" ON "CatalogProduct"("userId", "preparationStatus");

-- CreateIndex
CREATE INDEX "CatalogProduct_preparationStatus_preparationNextAttemptAt_idx" ON "CatalogProduct"("preparationStatus", "preparationNextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_userId_productId_key" ON "CatalogProduct"("userId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyInstallation_shopDomain_key" ON "ShopifyInstallation"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyInstallation_storefrontApiKeyId_key" ON "ShopifyInstallation"("storefrontApiKeyId");

-- CreateIndex
CREATE INDEX "ShopifyInstallation_userId_status_idx" ON "ShopifyInstallation"("userId", "status");

-- CreateIndex
CREATE INDEX "ShopifyInstallation_status_lastSyncedAt_idx" ON "ShopifyInstallation"("status", "lastSyncedAt");

-- CreateIndex
CREATE INDEX "ShopifySyncRun_installationId_startedAt_idx" ON "ShopifySyncRun"("installationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyWebhookEvent_webhookId_key" ON "ShopifyWebhookEvent"("webhookId");

-- CreateIndex
CREATE INDEX "ShopifyWebhookEvent_shopDomain_receivedAt_idx" ON "ShopifyWebhookEvent"("shopDomain", "receivedAt");

-- CreateIndex
CREATE INDEX "ShopifyWebhookEvent_topic_receivedAt_idx" ON "ShopifyWebhookEvent"("topic", "receivedAt");

-- CreateIndex
CREATE INDEX "GarmentMatch_userId_status_idx" ON "GarmentMatch"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GarmentMatch_userId_garmentId_key" ON "GarmentMatch"("userId", "garmentId");

-- CreateIndex
CREATE INDEX "WebsiteEvent_event_createdAt_idx" ON "WebsiteEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteEvent_path_createdAt_idx" ON "WebsiteEvent"("path", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationCode_email_purpose_expiresAt_idx" ON "VerificationCode"("email", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "VerificationCode_userId_purpose_expiresAt_idx" ON "VerificationCode"("userId", "purpose", "expiresAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Render" ADD CONSTRAINT "Render_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnResult" ADD CONSTRAINT "TryOnResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnResult" ADD CONSTRAINT "TryOnResult_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnFeedback" ADD CONSTRAINT "TryOnFeedback_tryOnResultId_fkey" FOREIGN KEY ("tryOnResultId") REFERENCES "TryOnResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TryOnFeedback" ADD CONSTRAINT "TryOnFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garment" ADD CONSTRAINT "Garment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyInstallation" ADD CONSTRAINT "ShopifyInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyInstallation" ADD CONSTRAINT "ShopifyInstallation_storefrontApiKeyId_fkey" FOREIGN KEY ("storefrontApiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifySyncRun" ADD CONSTRAINT "ShopifySyncRun_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "ShopifyInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarmentMatch" ADD CONSTRAINT "GarmentMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
