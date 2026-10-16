CREATE TABLE "UsageReservation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "quota" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "tryOnResultId" INTEGER,
    "renderId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UsageReservation_kind_check" CHECK ("kind" IN ('tryon', 'legacy_render')),
    CONSTRAINT "UsageReservation_state_check" CHECK ("status" IN ('reserved', 'committed', 'released')),
    CONSTRAINT "UsageReservation_period_check" CHECK ("periodEnd" > "periodStart" AND "quota" > 0),
    CONSTRAINT "UsageReservation_settled_check" CHECK (("status" = 'reserved') = ("settledAt" IS NULL)),
    CONSTRAINT "UsageReservation_result_check" CHECK ("tryOnResultId" IS NULL OR "kind" = 'tryon'),
    CONSTRAINT "UsageReservation_render_check" CHECK ("renderId" IS NULL OR "kind" = 'legacy_render'),
    CONSTRAINT "UsageReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UsageReservation_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsageReservation_requestId_key" ON "UsageReservation"("requestId");
CREATE UNIQUE INDEX "UsageReservation_tryOnResultId_key" ON "UsageReservation"("tryOnResultId");
CREATE UNIQUE INDEX "UsageReservation_renderId_key" ON "UsageReservation"("renderId");
CREATE INDEX "UsageReservation_userId_periodStart_periodEnd_status_idx" ON "UsageReservation"("userId", "periodStart", "periodEnd", "status");
CREATE INDEX "UsageReservation_status_createdAt_idx" ON "UsageReservation"("status", "createdAt");
