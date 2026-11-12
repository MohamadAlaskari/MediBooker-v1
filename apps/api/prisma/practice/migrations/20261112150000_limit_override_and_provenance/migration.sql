BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M04 part 3. The team books past the practice's limit of upcoming appointments (BR-02) with a
-- reason, sealed like the patient's note, because a team member may write something about a
-- person's health there. A nullable column: every existing appointment was booked within the limit.
ALTER TABLE "appointments" ADD COLUMN "limit_override_reason_encrypted" TEXT;

-- RT-97: who of the team added a patient without an account (W7), so that such a profile can be told
-- from an own profile of an account. Nullable: a profile of an account has none.
ALTER TABLE "patients" ADD COLUMN "added_by_id" UUID;

-- The profiles the team added before this version: the account the audit log names for the add.
UPDATE "patients" AS p SET "added_by_id" = substring(e."actor" FROM 6)::uuid
FROM (
    SELECT DISTINCT ON ("subject_id") "subject_id", "actor"
    FROM "audit_events"
    WHERE "action" IN ('patient.add_by_practice', 'patient.add_by_practice_despite_match')
        AND "actor" ~ '^user:[0-9a-f-]{36}$'
    ORDER BY "subject_id", "at"
) AS e
WHERE e."subject_id" = p."id" AND p."user_id" IS NULL AND p."added_by_id" IS NULL;

-- The check of RT-97 (an own profile has an account or was added by the team:
-- "relationship" <> 'SELF' OR "user_id" IS NOT NULL OR "added_by_id" IS NOT NULL) narrows what may
-- be written, and the release before this one adds patients without "added_by_id": it follows one
-- release later, with the same backfill first (expand, then contract; 07-docker-ci-cd.md §6).

COMMIT;
