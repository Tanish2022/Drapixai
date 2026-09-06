CREATE TRIGGER "SecurityAuditLog_immutable_truncate"
BEFORE TRUNCATE ON "SecurityAuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION drapixai_reject_security_audit_mutation();
