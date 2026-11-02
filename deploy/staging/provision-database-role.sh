#!/usr/bin/env bash
set -euo pipefail
set +x

[[ "${POSTGRES_USER:-}" == "drapixai_staging" && "${POSTGRES_DB:-}" == "drapixai_staging" ]] || {
  echo "Refusing runtime-role provisioning outside the dedicated staging database." >&2
  exit 2
}
password="$(cat /run/secrets/api_database_password)"
[[ "$password" =~ ^[A-Za-z0-9_-]{32,}$ ]] || {
  echo "Staging API database password must be a generated URL-safe secret." >&2
  exit 2
}

# Keep the password off command arguments and disable SQL echo in psql.
psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
\set ECHO none
BEGIN;
DO \$\$
BEGIN
  IF to_regclass('public."SecurityAuditLog"') IS NULL
    OR to_regclass('public."TermsDocument"') IS NULL
    OR to_regclass('public."AccountTermsAcceptance"') IS NULL THEN
    RAISE EXCEPTION 'Apply all release migrations before provisioning the API role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drapixai_staging_api') THEN
    CREATE ROLE drapixai_staging_api;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relowner = 'drapixai_staging_api'::regrole
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner = 'drapixai_staging_api'::regrole
    UNION ALL SELECT 1 FROM pg_database WHERE datdba = 'drapixai_staging_api'::regrole
    UNION ALL SELECT 1 FROM pg_proc WHERE proowner = 'drapixai_staging_api'::regrole
  ) THEN
    RAISE EXCEPTION 'API role owns database objects; transfer ownership through a reviewed migration first';
  END IF;
END
\$\$;
SELECT format('REVOKE %I FROM drapixai_staging_api', r.rolname)
FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
WHERE m.member = 'drapixai_staging_api'::regrole
\gexec
ALTER ROLE drapixai_staging_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '$password';
REVOKE ALL ON DATABASE drapixai_staging FROM PUBLIC;
REVOKE ALL ON DATABASE drapixai_staging FROM drapixai_staging_api;
GRANT CONNECT ON DATABASE drapixai_staging TO drapixai_staging_api;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM drapixai_staging_api;
GRANT USAGE ON SCHEMA public TO drapixai_staging_api;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, drapixai_staging_api;
-- Explicit reviewed release tables, never all present or future tables.
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
GRANT SELECT, INSERT, DELETE ON TABLE public."EmailDeliveryEvent" TO drapixai_staging_api;
GRANT SELECT, INSERT, UPDATE ON TABLE public."EmailRecipientSuppression" TO drapixai_staging_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, drapixai_staging_api;
GRANT USAGE, SELECT ON SEQUENCE
  public."User_id_seq", public."AccountTermsAcceptance_id_seq", public."ApiKey_id_seq",
  public."Usage_id_seq", public."UsageDaily_id_seq", public."EmailLog_id_seq",
  public."Render_id_seq", public."TryOnResult_id_seq", public."TryOnFeedback_id_seq",
  public."Garment_id_seq", public."CatalogProduct_id_seq", public."ShopifyInstallation_id_seq",
  public."ShopifySyncRun_id_seq", public."ShopifyWebhookEvent_id_seq", public."GarmentMatch_id_seq",
  public."WebsiteEvent_id_seq", public."SecurityAuditLog_id_seq", public."VerificationCode_id_seq"
TO drapixai_staging_api;
ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, drapixai_staging_api;
ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, drapixai_staging_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, drapixai_staging_api;
ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, drapixai_staging_api;
ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, drapixai_staging_api;
REVOKE ALL ON TABLE public."SecurityAuditLog" FROM drapixai_staging_api;
GRANT SELECT, INSERT ON TABLE public."SecurityAuditLog" TO drapixai_staging_api;
REVOKE ALL ON TABLE public."TermsDocument", public."AccountTermsAcceptance" FROM drapixai_staging_api;
GRANT SELECT, INSERT ON TABLE public."TermsDocument", public."AccountTermsAcceptance" TO drapixai_staging_api;
DO \$\$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM drapixai_staging_api;
  END IF;
END
\$\$;
COMMIT;
SQL
unset password
echo "PASS: staging API role provisioned without administrative, audit or terms-ledger mutation privileges."
