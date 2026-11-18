BEGIN;
CREATE TABLE "EmailDeliveryEvent" (
  "webhookId" TEXT PRIMARY KEY CHECK ("webhookId" ~ '^[A-Za-z0-9_-]{1,128}$'),
  "providerEmailId" TEXT NOT NULL CHECK ("providerEmailId" ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'),
  "recipientHash" TEXT NOT NULL CHECK ("recipientHash" ~ '^[a-f0-9]{64}$'),
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.complained','email.suppressed')),
  "eventDigest" TEXT NOT NULL CHECK ("eventDigest" ~ '^[a-f0-9]{64}$'),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmailDeliveryEvent_receivedAt_idx" ON "EmailDeliveryEvent" ("receivedAt");
CREATE INDEX "EmailDeliveryEvent_providerEmailId_idx" ON "EmailDeliveryEvent" ("providerEmailId");
CREATE TABLE "EmailRecipientSuppression" (
  "recipientHash" TEXT PRIMARY KEY CHECK ("recipientHash" ~ '^[a-f0-9]{64}$'),
  "reason" TEXT NOT NULL CHECK ("reason" IN ('hard_bounce','complaint')),
  "priority" INTEGER NOT NULL CHECK (("reason" = 'hard_bounce' AND "priority" = 1) OR ("reason" = 'complaint' AND "priority" = 2)),
  "providerEmailId" TEXT NOT NULL CHECK ("providerEmailId" ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE FUNCTION drapixai_email_suppression_sticky() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."recipientHash" IS DISTINCT FROM OLD."recipientHash" OR NEW."priority" < OLD."priority" THEN
    RAISE EXCEPTION 'EMAIL_SUPPRESSION_UPDATE_REJECTED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER drapixai_email_suppression_sticky
BEFORE UPDATE ON "EmailRecipientSuppression"
FOR EACH ROW EXECUTE FUNCTION drapixai_email_suppression_sticky();
COMMIT;
