BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- F04: the practice's identity. Applied by the practice's owner role (medibooker-db).
-- Privileges go to the database's own app role, named in the database setting
-- medibooker.app_role; the SQL is static and identical in every database, and where the setting
-- is unset (shadow and template databases) the grants are skipped (02 §9, ADR 0005 §4.2).

CREATE FUNCTION app_role() RETURNS name LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('medibooker.app_role', true), '')::name $$;

DO $$ BEGIN
  IF app_role() IS NOT NULL THEN
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role());
  END IF;
END $$;

-- CreateTable
CREATE TABLE "practice_identity" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "practice_id" UUID NOT NULL,

    CONSTRAINT "practice_identity_pkey" PRIMARY KEY ("id"),
    -- Hand-written: a singleton (02 §9).
    CONSTRAINT "practice_identity_id_check" CHECK (id = 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_identity_practice_id_key" ON "practice_identity"("practice_id");

-- The app role reads its identity but cannot change it (ADR 0005 §4.3).
DO $$ BEGIN
  IF app_role() IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON practice_identity FROM %I', app_role());
  END IF;
END $$;

COMMIT;
