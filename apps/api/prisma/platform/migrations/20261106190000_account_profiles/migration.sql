BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- D16 option B: the personal details and the insurance of an account, entered at sign-up. The default
-- privileges of the first migration give the app role access to the new table.

-- CreateEnum
CREATE TYPE "insurance_type" AS ENUM ('PUBLIC', 'PRIVATE', 'SELF_PAY');

-- CreateTable
CREATE TABLE "account_profiles" (
    "user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "phone" TEXT,
    "insurance_type" "insurance_type" NOT NULL,
    "insurance_provider" TEXT,
    "insurance_number_encrypted" TEXT,
    "insurance_number_end" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_profiles_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "account_profiles" ADD CONSTRAINT "account_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
