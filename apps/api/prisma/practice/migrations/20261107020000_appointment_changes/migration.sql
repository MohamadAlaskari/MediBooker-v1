BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- B03: when and by whom an appointment was cancelled, and which one a reschedule replaced (BR-04, BR-05).

-- AlterTable
ALTER TABLE "appointments"
    ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
    ADD COLUMN "cancelled_by_id" UUID,
    ADD COLUMN "rescheduled_from_id" UUID;

-- A cancelled appointment says when and by whom, and only a cancelled one does.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_check" CHECK (
    (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL))
    AND (("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "appointments_rescheduled_from_id_key" ON "appointments"("rescheduled_from_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
