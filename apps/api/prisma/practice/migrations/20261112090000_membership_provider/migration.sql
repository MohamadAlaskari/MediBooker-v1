-- M04: a doctor's account names the doctor it is, so that a doctor changes only its own working
-- hours, absences and times. M03's team screen sets the link; the role command can set it now.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "memberships" ADD COLUMN "staff_member_id" UUID;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "memberships_staff_member_id_key" ON "memberships"("staff_member_id");

COMMIT;
