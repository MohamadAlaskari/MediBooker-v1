BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- B01: a self-payer keeps no provider and no number (BR-10), whatever two changes at once may do.

ALTER TABLE "patients" ADD CONSTRAINT "patients_self_pay_keeps_nothing_check" CHECK (
    "insurance_type" <> 'SELF_PAY' OR (
        "insurance_provider" IS NULL
        AND "insurance_number_encrypted" IS NULL
        AND "insurance_number_end" IS NULL
        AND "insurance_number_index" IS NULL
    )
);

COMMIT;
