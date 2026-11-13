-- M03 part 1 (D17, ADR 0017): a base role, the practice team (STAFF) or a doctor (DOCTOR), and the
-- add-on practice management. An admin of before is the practice team with practice management: it
-- keeps everything it could do, and only management gives or changes roles from now on.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "memberships" ADD COLUMN "manages_practice" BOOLEAN NOT NULL DEFAULT false;

UPDATE "memberships" SET "role" = 'STAFF', "manages_practice" = true WHERE "role" = 'ADMIN';

-- contract: ADMIN leaves the role type. No row holds it after the update above; an API of before
-- this version that is still running while this migrates reads an admin as the practice team and
-- refuses it what management may do, until the new version runs (one installation, ADR 0016).
ALTER TYPE "staff_role" RENAME TO "staff_role_before_d17";

CREATE TYPE "staff_role" AS ENUM ('STAFF', 'DOCTOR');

-- contract: the column takes the new type; every value it holds is in it.
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "staff_role" USING ("role"::text::"staff_role");

-- contract: nothing uses the old type any more.
DROP TYPE "staff_role_before_d17";

COMMIT;
