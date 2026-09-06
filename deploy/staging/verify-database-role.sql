\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'drapixai_staging' OR current_user <> 'drapixai_staging' THEN
    RAISE EXCEPTION 'This verifier requires the dedicated staging database operator';
  END IF;
END
$$;

-- The transaction removes every synthetic row and table, including on failure.
CREATE TABLE public.drapixai_role_probe (id integer PRIMARY KEY, value text NOT NULL);
SET LOCAL ROLE drapixai_staging_api;
INSERT INTO public.drapixai_role_probe VALUES (1, 'before');
UPDATE public.drapixai_role_probe SET value = 'after' WHERE id = 1;
SELECT value FROM public.drapixai_role_probe WHERE id = 1;
DELETE FROM public.drapixai_role_probe WHERE id = 1;
INSERT INTO public."SecurityAuditLog" ("actorRole", "action", "previousHash", "entryHash")
VALUES ('staging-role-verifier', 'synthetic-rollback-only', 'GENESIS', md5(random()::text));

DO $$
DECLARE
  statement text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'API role retains administrative privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = current_user::regrole) THEN
    RAISE EXCEPTION 'API role retains unexpected role memberships';
  END IF;
  IF has_schema_privilege(current_user, 'public', 'CREATE')
    OR has_database_privilege(current_user, current_database(), 'CREATE')
    OR has_database_privilege(current_user, current_database(), 'TEMP') THEN
    RAISE EXCEPTION 'API role retains DDL privileges';
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL
    AND has_table_privilege(current_user, 'public._prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'API role can access migration control records';
  END IF;
  FOREACH statement IN ARRAY ARRAY[
    'UPDATE public."SecurityAuditLog" SET "outcome" = ''tampered''',
    'DELETE FROM public."SecurityAuditLog"',
    'TRUNCATE public."SecurityAuditLog"',
    'TRUNCATE public.drapixai_role_probe',
    'ALTER TABLE public."SecurityAuditLog" DISABLE TRIGGER ALL',
    'DROP TABLE public."SecurityAuditLog"',
    'CREATE TABLE public.drapixai_forbidden_probe (id integer)',
    'CREATE ROLE drapixai_forbidden_role'
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Forbidden runtime operation unexpectedly succeeded: %', statement;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
END
$$;
ROLLBACK;
\echo PASS: runtime DML and audit append work; admin, DDL, audit mutation and TRUNCATE are denied.
