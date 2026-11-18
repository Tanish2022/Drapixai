-- PROPOSAL ONLY. Not executed on Neon. Run only after reviewed staging migration
-- 20261027130000_shopify_expiring_tokens, with endpoint/branch identity verified
-- using the existing operator tooling. No production target or default grants.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'drapixai_staging' OR current_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'Staging operator identity required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations
    WHERE migration_name='20261027130000_shopify_expiring_tokens'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'Reviewed token migration must be applied first';
  END IF;
END $$;
REVOKE ALL ON TABLE public."ShopifyTokenLease" FROM PUBLIC, drapixai_staging_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ShopifyTokenLease" TO drapixai_staging_api;
COMMIT;
