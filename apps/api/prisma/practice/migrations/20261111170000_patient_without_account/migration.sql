BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M05 (W7): the team adds a patient who has no account, or not yet one, and books for them on the
-- phone and at the desk. Such a profile is the person's own (SELF, not a CHILD of FA01) and has no
-- user yet. The check of B01 asked every own profile for its account; the partial unique index
-- patients_self_user_key still allows one own profile per account.

-- contract: drops a check that only narrowed what may be written. The API before this version never
-- writes an own profile without a user, and no reader of the table assumes one has a user.
ALTER TABLE "patients" DROP CONSTRAINT "patients_self_has_user_check";

COMMIT;
