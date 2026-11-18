ALTER TABLE "BillingWebhookEvent" ADD COLUMN "payloadDigest" TEXT;

ALTER TABLE "BillingWebhookEvent" ADD CONSTRAINT "BillingWebhookEvent_payloadDigest_check"
    CHECK ("payloadDigest" IS NULL OR "payloadDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "User" ADD COLUMN "subscriptionCurrentPeriodStartsAt" TIMESTAMP(3);

ALTER TABLE "User" ADD CONSTRAINT "User_subscriptionPeriod_check"
    CHECK ("subscriptionCurrentPeriodStartsAt" IS NULL OR (
        "subscriptionCurrentPeriodEndsAt" IS NOT NULL AND
        "subscriptionCurrentPeriodStartsAt" < "subscriptionCurrentPeriodEndsAt"
    ));
