BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- A04 part 2b (ADR 0004 §8): session control and the security e-mails. All additive: the release
-- before writes none of it and reads around it.

-- The "this was not me" link of the security e-mails, and their three templates.
ALTER TYPE "account_token_purpose" ADD VALUE IF NOT EXISTS 'SECURE_ACCOUNT';
ALTER TYPE "account_notification_template" ADD VALUE IF NOT EXISTS 'NEW_SIGN_IN';
ALTER TYPE "account_notification_template" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE "account_notification_template" ADD VALUE IF NOT EXISTS 'SECOND_FACTOR_ENABLED';

-- Failed sign-ins of clients the account does not know decay from the last one, so that one guess
-- an hour keeps no account waiting; after 100 since the last success only a new password lets
-- such clients in again. The first sign-in of an account tells its owner nothing new.
ALTER TABLE "users" ADD COLUMN "failed_login_at" TIMESTAMPTZ(3),
ADD COLUMN "failed_since_success" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN "first_signed_in_at" TIMESTAMPTZ(3);
UPDATE "users" AS u SET "first_signed_in_at" = f."first"
FROM (SELECT "user_id", min("created_at") AS "first" FROM "sessions" GROUP BY "user_id") AS f
WHERE u."id" = f."user_id";

-- A family ends at an absolute time from its sign-in, and the session list names the device.
ALTER TABLE "sessions" ADD COLUMN "family_started_at" TIMESTAMPTZ(3),
ADD COLUMN "device" TEXT;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_check" CHECK (char_length("device") <= 60);
UPDATE "sessions" AS s SET "family_started_at" = f."started"
FROM (SELECT "family_id", min("created_at") AS "started" FROM "sessions" GROUP BY "family_id") AS f
WHERE s."family_id" = f."family_id";

-- The browsers an account signed in with (a keyed hash of the device cookie): a sign-in from another
-- one gets the "new sign-in" e-mail (E10). Each counts its own failed sign-ins, so a stranger's
-- guesses never make a browser of the owner wait.
CREATE TABLE "known_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "failed_count" SMALLINT NOT NULL DEFAULT 0,
    "failed_at" TIMESTAMPTZ(3),
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "known_devices_user_id_device_hash_key" ON "known_devices"("user_id", "device_hash");
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What E10 names: the sign-in's device and time come from its session.
ALTER TABLE "account_notifications" ADD COLUMN "session_id" UUID;
CREATE INDEX "account_notifications_session_id_idx" ON "account_notifications"("session_id");
ALTER TABLE "account_notifications" ADD CONSTRAINT "account_notifications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
