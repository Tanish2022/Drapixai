CREATE TABLE "SecurityAuditLog" (
  "id" SERIAL NOT NULL,
  "actorUserId" INTEGER,
  "actorRole" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "outcome" TEXT NOT NULL DEFAULT 'success',
  "requestId" TEXT,
  "ipHash" TEXT,
  "metadata" JSONB,
  "previousHash" TEXT NOT NULL,
  "entryHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityAuditLog_entryHash_key" ON "SecurityAuditLog"("entryHash");
CREATE INDEX "SecurityAuditLog_actorUserId_createdAt_idx" ON "SecurityAuditLog"("actorUserId", "createdAt");
CREATE INDEX "SecurityAuditLog_action_createdAt_idx" ON "SecurityAuditLog"("action", "createdAt");
CREATE INDEX "SecurityAuditLog_targetType_targetId_createdAt_idx" ON "SecurityAuditLog"("targetType", "targetId", "createdAt");

CREATE OR REPLACE FUNCTION drapixai_reject_security_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SecurityAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecurityAuditLog_immutable_update"
BEFORE UPDATE ON "SecurityAuditLog"
FOR EACH ROW EXECUTE FUNCTION drapixai_reject_security_audit_mutation();

CREATE TRIGGER "SecurityAuditLog_immutable_delete"
BEFORE DELETE ON "SecurityAuditLog"
FOR EACH ROW EXECUTE FUNCTION drapixai_reject_security_audit_mutation();
