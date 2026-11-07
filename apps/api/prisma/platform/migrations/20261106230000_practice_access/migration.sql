BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- B01: the membership index and the references to each practice's data keys. medibooker-db provision
-- writes the references, on a rerun also for a practice that has none yet. The default privileges of
-- the first migration give the app role access to the new table.

-- CreateEnum
CREATE TYPE "practice_capacity" AS ENUM ('STAFF', 'PATIENT');

-- AlterTable
ALTER TABLE "practices" ADD COLUMN "field_key_refs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "practice_access" (
    "user_id" UUID NOT NULL,
    "practice_id" UUID NOT NULL,
    "capacity" "practice_capacity" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "source_version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_access_pkey" PRIMARY KEY ("user_id","practice_id","capacity")
);

-- CreateIndex
CREATE INDEX "practice_access_practice_id_idx" ON "practice_access"("practice_id");

-- AddForeignKey
ALTER TABLE "practice_access" ADD CONSTRAINT "practice_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_access" ADD CONSTRAINT "practice_access_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
