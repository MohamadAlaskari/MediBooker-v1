BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- F04: the practice registry, the database clusters and the platform audit log (ADR 0005 §1.1).
-- Applied by platform_owner (medibooker-db migrate platform).

-- Every table created from here on is readable and writable for the API's role unless a REVOKE
-- below or a later migration narrows it (02 §9).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO platform_app;

-- Readiness compares the newest applied migration with PLATFORM_SCHEMA_REQUIRED (02 §10). Prisma
-- creates _prisma_migrations before this script runs, but not in a shadow database.
DO $$ BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    GRANT SELECT ON _prisma_migrations TO platform_app;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "practice_status" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'MOVING', 'RESTORE_REVIEW', 'DEPROVISIONING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "database_cluster_tls_mode" AS ENUM ('DISABLE', 'VERIFY_FULL');

-- CreateEnum
CREATE TYPE "database_cluster_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "platform_audit_outcome" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "database_clusters" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "tls_mode" "database_cluster_tls_mode" NOT NULL,
    "ca_secret_ref" TEXT,
    "provisioner_secret_ref" TEXT,
    "database_limit" INTEGER NOT NULL,
    "status" "database_cluster_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "practice_status" NOT NULL DEFAULT 'PROVISIONING',
    "market" CHAR(2) NOT NULL,
    "cluster_id" TEXT,
    "database_name" TEXT,
    "app_secret_ref" TEXT,
    "owner_secret_ref" TEXT,
    "route_version" INTEGER NOT NULL DEFAULT 1,
    "schema_version" TEXT,
    "migrated_at" TIMESTAMPTZ(3),
    "migration_error_code" TEXT,
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_slugs" (
    "slug" TEXT NOT NULL,
    "practice_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "practice_slugs_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "platform_audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "practice_id" UUID,
    "outcome" "platform_audit_outcome" NOT NULL,
    "error_code" TEXT,
    "approval_ref" TEXT,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practices_database_name_key" ON "practices"("database_name");

-- CreateIndex
CREATE UNIQUE INDEX "practice_slugs_current_practice_id_key" ON "practice_slugs"("practice_id") WHERE (retired_at IS NULL);

-- AddForeignKey
ALTER TABLE "practices" ADD CONSTRAINT "practices_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "database_clusters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_slugs" ADD CONSTRAINT "practice_slugs_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: what Prisma cannot express (02 §9).
ALTER TABLE "practice_slugs" ADD CONSTRAINT "practice_slugs_slug_check" CHECK (slug ~ '^[a-z0-9-]{3,40}$');
ALTER TABLE "practices" ADD CONSTRAINT "practices_market_check" CHECK (market ~ '^[A-Z]{2}$');
ALTER TABLE "practices" ADD CONSTRAINT "practices_database_name_check" CHECK (database_name ~ '^practice_[0-9a-f]{32}$');

-- Only medibooker-db changes routing, lifecycle and clusters (ADR 0005 §4.4); later items grant
-- column privileges on practices (P01, A04). The platform audit log is append-only (ADR 0005 §4.3).
REVOKE INSERT, UPDATE, DELETE ON practices, database_clusters FROM platform_app;
REVOKE UPDATE, DELETE ON platform_audit_events FROM platform_app;

COMMIT;
