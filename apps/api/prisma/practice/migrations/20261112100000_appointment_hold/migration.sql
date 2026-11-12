-- M04 part 2 (BR-27): an appointment holds its doctor from its start for the service's duration and
-- then for its buffer. Every slot of that time is BOOKED and names the appointment (held_by_id), and
-- the appointment keeps the end of its visit (ends_at), as the service's duration was at booking.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "appointments" ADD COLUMN "ends_at" TIMESTAMPTZ(3);
-- Booked before: an appointment held its one slot and ended with it.
UPDATE "appointments" AS a SET "ends_at" = s."ends_at" FROM "slots" AS s WHERE s."id" = a."slot_id";
ALTER TABLE "appointments" ALTER COLUMN "ends_at" SET NOT NULL;

ALTER TABLE "slots" ADD COLUMN "held_by_id" UUID;
UPDATE "slots" AS s SET "held_by_id" = a."id"
FROM "appointments" AS a
WHERE a."slot_id" = s."id" AND a."status" <> 'CANCELLED' AND s."status" = 'BOOKED';
ALTER TABLE "slots" ADD CONSTRAINT "slots_held_by_id_fkey" FOREIGN KEY ("held_by_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A free or blocked slot is part of no appointment's time.
ALTER TABLE "slots" ADD CONSTRAINT "slots_held_is_booked_check" CHECK ("held_by_id" IS NULL OR "status" = 'BOOKED');
CREATE INDEX "slots_held_by_id_idx" ON "slots"("held_by_id");

-- Expand and contract (docs/architecture/07-docker-ci-cd.md): the release before this one runs on
-- this schema during a deploy and after a rollback. It books without an end of the visit, which its
-- slot then was; and it frees only the first slot of a cancelled appointment.
CREATE FUNCTION appointments_default_ends_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT s.ends_at INTO NEW.ends_at FROM slots AS s WHERE s.id = NEW.slot_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "appointments_ends_at_default"
  BEFORE INSERT ON "appointments"
  FOR EACH ROW WHEN (NEW.ends_at IS NULL)
  EXECUTE FUNCTION appointments_default_ends_at();

-- A cancelled appointment holds no time: every slot it held is free again, and its first slot when a
-- release before this one booked it without naming it. In the database, so that the whole time is
-- free whichever code cancels; the code locks the slots in the order of their starts before.
CREATE FUNCTION appointments_release_on_cancel() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE slots SET status = 'OPEN', held_by_id = NULL
  WHERE held_by_id = NEW.id
     OR (id = NEW.slot_id AND held_by_id IS NULL AND status = 'BOOKED');
  RETURN NULL;
END;
$$;
CREATE TRIGGER "appointments_release_on_cancel"
  AFTER UPDATE OF status ON "appointments"
  FOR EACH ROW WHEN (NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED')
  EXECUTE FUNCTION appointments_release_on_cancel();

COMMIT;
