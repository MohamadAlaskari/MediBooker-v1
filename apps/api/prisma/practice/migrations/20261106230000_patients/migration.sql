BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- B01: the patients of this practice, its insurance rules, the outbox towards the platform database
-- and the audit log. The default privileges of the first migration give the app role access to the
-- new tables; the audit log is append-only for it.

-- CreateEnum
CREATE TYPE "insurance_type" AS ENUM ('PUBLIC', 'PRIVATE', 'SELF_PAY');

-- CreateEnum
CREATE TYPE "patient_relationship" AS ENUM ('SELF', 'CHILD');

-- AlterTable
ALTER TABLE "practice_settings" ADD COLUMN     "insurance_number_types" TEXT[] DEFAULT ARRAY['PUBLIC', 'PRIVATE']::TEXT[],
ADD COLUMN     "insurance_provider_types" TEXT[] DEFAULT ARRAY['PUBLIC', 'PRIVATE']::TEXT[],
ADD COLUMN     "insurance_types" TEXT[] DEFAULT ARRAY['PUBLIC', 'PRIVATE', 'SELF_PAY']::TEXT[];

-- A self-payer never needs a number (BR-10).
ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_self_pay_number_check"
    CHECK (NOT ('SELF_PAY' = ANY ("insurance_number_types")));

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "relationship" "patient_relationship" NOT NULL DEFAULT 'SELF',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "contact_phone" TEXT,
    "insurance_type" "insurance_type" NOT NULL,
    "insurance_provider" TEXT,
    "insurance_number_encrypted" TEXT,
    "insurance_number_end" TEXT,
    "insurance_number_index" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patients_self_has_user_check" CHECK ("relationship" <> 'SELF' OR "user_id" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "patients_insurance_number_index_idx" ON "patients"("insurance_number_index");

-- At most one own profile per account in this practice.
CREATE UNIQUE INDEX "patients_self_user_key" ON "patients"("user_id") WHERE "relationship" = 'SELF';

-- CreateTable
CREATE TABLE "integration_outbox" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "integration_outbox_pkey" PRIMARY KEY ("id")
);

-- What the relay still has to do.
CREATE INDEX "integration_outbox_due_idx" ON "integration_outbox"("id") WHERE "processed_at" IS NULL;

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "at" TIMESTAMPTZ(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_id" UUID,
    "ip_hash" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_subject_id_idx" ON "audit_events"("subject_id");

DO $$
BEGIN
  IF app_role() IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE, DELETE ON audit_events FROM %I', app_role());
  END IF;
END
$$;

COMMIT;
