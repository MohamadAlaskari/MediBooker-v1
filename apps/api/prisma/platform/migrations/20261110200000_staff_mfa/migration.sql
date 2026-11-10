BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- A04: the second factor of an account (ADR 0004 §7). The TOTP secret is encrypted with the field
-- keys of the platform and bound to its row; a recovery code is stored only as a keyed hash. The
-- default privileges of the first migration give the app role access to the new table.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "totp_last_step" BIGINT,
ADD COLUMN     "totp_secret_encrypted" TEXT;

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
