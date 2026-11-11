BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M05: the practice's side of an appointment. When the team checked the patient in and completed
-- the visit (BR-11), and the reason of a cancel by the practice (BR-04), sealed like the patient's
-- note, because a team member may write something about a person's health there. Nullable
-- columns: every existing row stays as it is, and none is checked in or completed yet.

-- AlterTable
ALTER TABLE "appointments"
    ADD COLUMN "cancel_reason_encrypted" TEXT,
    ADD COLUMN "checked_in_at" TIMESTAMPTZ(3),
    ADD COLUMN "completed_at" TIMESTAMPTZ(3);

-- A visit says when it was checked in and completed, and only such a visit does; only a cancelled
-- appointment has a reason.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_desk_check" CHECK (
    (("status" IN ('CHECKED_IN', 'COMPLETED')) = ("checked_in_at" IS NOT NULL))
    AND (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL))
    AND ("cancel_reason_encrypted" IS NULL OR "status" = 'CANCELLED')
);

COMMIT;
