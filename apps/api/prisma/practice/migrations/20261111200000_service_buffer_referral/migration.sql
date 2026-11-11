-- M02, W13: what a service asks of a patient and of its doctor's day. A service can need a referral
-- (BR-26), which patients and the team see; and it can keep its doctor free for some minutes after
-- each appointment (BR-27), for cleaning or notes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "services" ADD COLUMN "buffer_minutes" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "services" ADD COLUMN "referral_required" BOOLEAN NOT NULL DEFAULT false;
-- Hand-written: at most two hours, as W13 offers.
ALTER TABLE "services" ADD CONSTRAINT "services_buffer_check" CHECK (buffer_minutes BETWEEN 0 AND 120);

COMMIT;
