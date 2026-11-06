BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- P04: the weekly templates of the providers, their absences and the slots generated from both.
-- The default privileges of the first migration give the app role access to every table here.

-- CreateEnum
CREATE TYPE "availability_exception_reason" AS ENUM ('VACATION', 'HOLIDAY', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "slot_status" AS ENUM ('OPEN', 'BOOKED', 'BLOCKED');

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "slot_minutes" SMALLINT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id"),
    -- Hand-written: the value ranges of BR-06.
    CONSTRAINT "availability_rules_weekday_check" CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT "availability_rules_interval_check" CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute),
    CONSTRAINT "availability_rules_slot_minutes_check" CHECK (slot_minutes BETWEEN 5 AND 240),
    CONSTRAINT "availability_rules_validity_check" CHECK (valid_to IS NULL OR valid_from <= valid_to)
);

-- CreateTable
CREATE TABLE "availability_rule_services" (
    "rule_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "availability_rule_services_pkey" PRIMARY KEY ("rule_id","service_id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" "availability_exception_reason" NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id"),
    -- Hand-written.
    CONSTRAINT "availability_exceptions_interval_check" CHECK (starts_at < ends_at)
);

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "slot_status" NOT NULL DEFAULT 'OPEN',
    "rule_id" UUID,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id"),
    -- Hand-written: a provider is in one place at a time, whatever the rules say.
    CONSTRAINT "slots_interval_check" CHECK (ends_at > starts_at),
    CONSTRAINT "slots_no_overlap" EXCLUDE USING gist (provider_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
);

-- CreateIndex
CREATE INDEX "slots_rule_id_idx" ON "slots"("rule_id");

-- CreateIndex
CREATE INDEX "slots_open_starts_at_idx" ON "slots"("starts_at") WHERE (status = 'OPEN'::slot_status);

-- CreateIndex
CREATE UNIQUE INDEX "slots_provider_id_starts_at_key" ON "slots"("provider_id", "starts_at");

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rule_services" ADD CONSTRAINT "availability_rule_services_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "availability_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rule_services" ADD CONSTRAINT "availability_rule_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "availability_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
