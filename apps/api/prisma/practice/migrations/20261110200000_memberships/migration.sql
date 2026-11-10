BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- A04: who works in this practice, and in which role (ADR 0005 §1.1). The membership index of the
-- platform database follows this table through the integration outbox; this table decides. The
-- default privileges of the first migration give the app role access to the new table.

-- CreateEnum
CREATE TYPE "staff_role" AS ENUM ('STAFF', 'DOCTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role" "staff_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_key" ON "memberships"("user_id");

COMMIT;
