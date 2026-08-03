CREATE TABLE "ApiIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "route" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'processing',
    "responseStatus" INTEGER,
    "tryOnResultId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseCode" INTEGER,
    "errorCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiIdempotencyRecord_userId_route_keyHash_key" ON "ApiIdempotencyRecord"("userId", "route", "keyHash");
CREATE INDEX "ApiIdempotencyRecord_expiresAt_idx" ON "ApiIdempotencyRecord"("expiresAt");
CREATE INDEX "WebhookEndpoint_userId_isActive_idx" ON "WebhookEndpoint"("userId", "isActive");
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

ALTER TABLE "ApiIdempotencyRecord" ADD CONSTRAINT "ApiIdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiIdempotencyRecord" ADD CONSTRAINT "ApiIdempotencyRecord_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
