-- Review/apply separately after migration 20261031090000 on staging only.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'drapixai_staging' OR current_user <> 'neondb_owner' THEN RAISE EXCEPTION 'STAGING_OPERATOR_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='drapixai_staging_api') THEN RAISE EXCEPTION 'STAGING_RUNTIME_ROLE_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations
    WHERE migration_name='20261031090000_email_delivery_events'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'REVIEWED_EMAIL_MIGRATION_REQUIRED';
  END IF;
END $$;
REVOKE ALL ON "EmailDeliveryEvent", "EmailRecipientSuppression" FROM PUBLIC, drapixai_staging_api;
GRANT SELECT, INSERT, DELETE ON "EmailDeliveryEvent" TO drapixai_staging_api;
GRANT SELECT, INSERT, UPDATE ON "EmailRecipientSuppression" TO drapixai_staging_api;
REVOKE DELETE, TRUNCATE ON "EmailRecipientSuppression" FROM drapixai_staging_api;
-- The trigger also rejects moving a recipient hash or downgrading a complaint.
-- A separately authorized owner/reviewer operation is required to release a block.
COMMIT;
