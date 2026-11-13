BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M03 part 1 (D17, ADR 0017): what practice management did to someone's place in the team, told
-- to that person, without a link and without the role itself. All additive: the release before
-- writes none of them.
ALTER TYPE "account_notification_template" ADD VALUE IF NOT EXISTS 'TEAM_ROLE_CHANGED';
ALTER TYPE "account_notification_template" ADD VALUE IF NOT EXISTS 'TEAM_ACCESS_ENDED';
ALTER TYPE "account_notification_template" ADD VALUE IF NOT EXISTS 'TEAM_SECOND_FACTOR_RESET';

COMMIT;
