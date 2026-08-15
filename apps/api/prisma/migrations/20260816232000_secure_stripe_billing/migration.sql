ALTER TABLE "User"
    ADD COLUMN "subscriptionEventCreatedAt" TIMESTAMP(3),
    ADD COLUMN "subscriptionEventPriority" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "BillingCheckoutAttempt" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "idempotencyKeyHash" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingCheckoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingUsagePeriod" (
    "id" TEXT NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "renderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingUsagePeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "providerCreatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingCheckoutAttempt_providerSessionId_key" ON "BillingCheckoutAttempt"("providerSessionId");
CREATE UNIQUE INDEX "User_subscriptionCustomerId_key" ON "User"("subscriptionCustomerId");
CREATE UNIQUE INDEX "User_subscriptionId_key" ON "User"("subscriptionId");
CREATE UNIQUE INDEX "BillingCheckoutAttempt_userId_idempotencyKeyHash_key" ON "BillingCheckoutAttempt"("userId", "idempotencyKeyHash");
CREATE INDEX "BillingCheckoutAttempt_expiresAt_idx" ON "BillingCheckoutAttempt"("expiresAt");
CREATE INDEX "BillingCheckoutAttempt_userId_status_idx" ON "BillingCheckoutAttempt"("userId", "status");
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx" ON "BillingWebhookEvent"("status", "receivedAt");
CREATE INDEX "BillingWebhookEvent_type_receivedAt_idx" ON "BillingWebhookEvent"("type", "receivedAt");
CREATE UNIQUE INDEX "BillingUsagePeriod_apiKeyId_periodStart_periodEnd_key" ON "BillingUsagePeriod"("apiKeyId", "periodStart", "periodEnd");
CREATE INDEX "BillingUsagePeriod_periodStart_periodEnd_idx" ON "BillingUsagePeriod"("periodStart", "periodEnd");

ALTER TABLE "BillingCheckoutAttempt" ADD CONSTRAINT "BillingCheckoutAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingUsagePeriod" ADD CONSTRAINT "BillingUsagePeriod_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
