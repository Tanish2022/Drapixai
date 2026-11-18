-- Neon staging only. Operator checks the fixed endpoint and database first.
-- Role creation/password handling is separate; no credential belongs in SQL files.
DO $$
BEGIN
  IF current_database() <> 'drapixai_staging' OR current_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'Staging operator identity required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='drapixai_staging_api'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member='drapixai_staging_api'::regrole)
    OR EXISTS (SELECT 1 FROM pg_class WHERE relowner='drapixai_staging_api'::regrole)
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner='drapixai_staging_api'::regrole)
    OR EXISTS (SELECT 1 FROM pg_database WHERE datdba='drapixai_staging_api'::regrole)
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner='drapixai_staging_api'::regrole) THEN
    RAISE EXCEPTION 'Unexpected runtime administration, membership or ownership';
  END IF;
END $$;
-- statement --
REVOKE ALL ON DATABASE drapixai_staging FROM PUBLIC;
-- statement --
REVOKE ALL ON DATABASE drapixai_staging FROM drapixai_staging_api;
-- statement --
GRANT CONNECT ON DATABASE drapixai_staging TO drapixai_staging_api;
-- statement --
-- Fixed legacy application database on the schema-only staging branch. Do not
-- modify provider-owned postgres/template databases or discover new targets.
REVOKE CONNECT ON DATABASE neondb FROM PUBLIC;
-- statement --
REVOKE ALL ON DATABASE neondb FROM drapixai_staging_api;
-- statement --
REVOKE ALL ON SCHEMA public FROM PUBLIC;
-- statement --
REVOKE ALL ON SCHEMA public FROM drapixai_staging_api;
-- statement --
GRANT USAGE ON SCHEMA public TO drapixai_staging_api;
-- statement --
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, drapixai_staging_api;
-- statement --
-- Explicit release allowlist: a new/unreviewed table must not receive CRUD
-- merely because this provisioning policy is rerun after a migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."User", public."ApiKey", public."ApiIdempotencyRecord",
  public."Usage", public."UsageDaily", public."BillingUsagePeriod", public."UsageReservation",
  public."EmailLog", public."Render", public."TryOnResult", public."TryOnFeedback",
  public."Garment", public."CatalogProduct", public."ShopifyInstallation",
  public."ShopifyTokenLease", public."ShopifySyncRun", public."ShopifyWebhookEvent",
  public."BillingCheckoutAttempt", public."BillingWebhookEvent",
  public."WebhookEndpoint", public."WebhookDelivery", public."CatalogPreparationLease",
  public."ShopifyPreparationJob", public."GarmentMatch", public."WebsiteEvent", public."VerificationCode"
TO drapixai_staging_api;
-- statement --
GRANT SELECT, INSERT, DELETE ON TABLE public."EmailDeliveryEvent" TO drapixai_staging_api;
-- statement --
GRANT SELECT, INSERT, UPDATE ON TABLE public."EmailRecipientSuppression" TO drapixai_staging_api;
-- statement --
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, drapixai_staging_api;
-- statement --
GRANT USAGE, SELECT ON SEQUENCE
  public."User_id_seq", public."AccountTermsAcceptance_id_seq", public."ApiKey_id_seq",
  public."Usage_id_seq", public."UsageDaily_id_seq", public."EmailLog_id_seq",
  public."Render_id_seq", public."TryOnResult_id_seq", public."TryOnFeedback_id_seq",
  public."Garment_id_seq", public."CatalogProduct_id_seq", public."ShopifyInstallation_id_seq",
  public."ShopifySyncRun_id_seq", public."ShopifyWebhookEvent_id_seq", public."GarmentMatch_id_seq",
  public."WebsiteEvent_id_seq", public."SecurityAuditLog_id_seq", public."VerificationCode_id_seq"
TO drapixai_staging_api;
-- statement --
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, drapixai_staging_api;
-- statement --
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
-- statement --
-- New tables require a deliberate grant after migration. Future audit/evidence
-- tables must not accidentally inherit broad UPDATE/DELETE access.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE ALL ON TABLES FROM drapixai_staging_api;
-- statement --
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
-- statement --
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM drapixai_staging_api;
-- statement --
-- PostgreSQL's default PUBLIC EXECUTE grant is global within this database;
-- a per-schema REVOKE cannot remove it. This does not affect other databases.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- statement --
REVOKE ALL ON TABLE public."SecurityAuditLog", public."TermsDocument", public."AccountTermsAcceptance" FROM drapixai_staging_api;
-- statement --
GRANT SELECT, INSERT ON TABLE public."SecurityAuditLog", public."TermsDocument", public."AccountTermsAcceptance" TO drapixai_staging_api;
-- statement --
REVOKE ALL ON TABLE public._prisma_migrations FROM drapixai_staging_api;
