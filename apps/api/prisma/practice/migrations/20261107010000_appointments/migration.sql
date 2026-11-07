BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- B02: the appointments of this practice and what an Idempotency-Key answered. The default privileges
-- of the first migration give the app role access to the new tables.

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'BOOKED',
    "patient_note_encrypted" TEXT,
    "booked_by_id" UUID NOT NULL,
    "booked_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "actor_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "appointment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("actor_id","key")
);

-- CreateIndex
CREATE INDEX "appointments_patient_id_idx" ON "appointments"("patient_id");

-- CreateIndex
CREATE INDEX "appointments_service_id_idx" ON "appointments"("service_id");

-- BR-01: at most one appointment that holds a slot, also if a bug passes the row locks.
CREATE UNIQUE INDEX "appointments_slot_active_key" ON "appointments"("slot_id") WHERE (status <> 'CANCELLED'::appointment_status);

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
