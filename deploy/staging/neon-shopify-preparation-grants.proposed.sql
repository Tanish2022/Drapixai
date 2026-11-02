-- PROPOSAL ONLY. Not executed on Neon. Requires the reviewed staging migration
-- and a separately verified branch/endpoint using existing operator tooling.
-- No production target, role creation, ownership change or default grants.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'drapixai_staging' OR current_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'Staging operator identity required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations
    WHERE migration_name='20261030090000_shopify_catalog_reliability'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'Reviewed catalog reliability migration must be applied first';
  END IF;
END $$;
REVOKE ALL ON TABLE public."ShopifyPreparationJob" FROM PUBLIC, drapixai_staging_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ShopifyPreparationJob" TO drapixai_staging_api;
COMMIT;
