BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- A04, from its security review: wrong codes of the second factor count on their own. A new
-- password clears the failed sign-ins, and must not give whoever reads the mailbox a new budget for
-- guessing codes.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_failed_count" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "mfa_locked_until" TIMESTAMPTZ(3);

COMMIT;
