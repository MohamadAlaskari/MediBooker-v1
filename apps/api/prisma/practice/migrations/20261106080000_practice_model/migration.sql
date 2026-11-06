BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- P01: the practice's settings, public page, opening hours, special days, theme, services and team.
-- btree_gist is a trusted extension: the owner creates it without superuser rights (02 §9). The
-- default privileges of the first migration give the app role access to every table here.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "theme_preset" AS ENUM ('TEAL', 'OCEAN', 'INDIGO', 'VIOLET', 'GRAPHITE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "staff_consent_type" AS ENUM ('PHOTO', 'PUBLIC_PROFILE');

-- CreateTable
CREATE TABLE "practice_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "default_locale" TEXT NOT NULL DEFAULT 'ar',
    "supported_locales" TEXT[] DEFAULT ARRAY['ar', 'en']::TEXT[],
    "week_start" SMALLINT NOT NULL DEFAULT 1,
    "weekend_days" SMALLINT[],
    "numbering_system" TEXT NOT NULL DEFAULT 'latn',
    "hour_cycle" TEXT NOT NULL DEFAULT 'h23',
    "phone" TEXT,
    "email" TEXT,
    "address" JSONB NOT NULL DEFAULT '{}',
    "max_future_appointments_per_patient" SMALLINT NOT NULL DEFAULT 2,
    "min_lead_time_minutes" INTEGER NOT NULL DEFAULT 120,
    "max_horizon_days" SMALLINT NOT NULL DEFAULT 90,
    "cancellation_deadline_hours" SMALLINT NOT NULL DEFAULT 24,
    "reminder_hours_before" SMALLINT NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_settings_pkey" PRIMARY KEY ("id"),
    -- Hand-written: a singleton, and the value ranges of the business rules.
    CONSTRAINT "practice_settings_id_check" CHECK (id = 1),
    CONSTRAINT "practice_settings_default_locale_check" CHECK (default_locale = ANY (supported_locales)),
    CONSTRAINT "practice_settings_week_start_check" CHECK (week_start BETWEEN 1 AND 7),
    CONSTRAINT "practice_settings_weekend_days_check" CHECK (weekend_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]),
    CONSTRAINT "practice_settings_numbering_system_check" CHECK (numbering_system IN ('latn', 'arab')),
    CONSTRAINT "practice_settings_hour_cycle_check" CHECK (hour_cycle IN ('h12', 'h23')),
    CONSTRAINT "practice_settings_address_check" CHECK (jsonb_typeof(address) = 'object'),
    CONSTRAINT "practice_settings_max_future_check" CHECK (max_future_appointments_per_patient BETWEEN 1 AND 20),
    CONSTRAINT "practice_settings_min_lead_time_check" CHECK (min_lead_time_minutes BETWEEN 0 AND 10080),
    CONSTRAINT "practice_settings_max_horizon_check" CHECK (max_horizon_days BETWEEN 1 AND 365),
    CONSTRAINT "practice_settings_cancellation_check" CHECK (cancellation_deadline_hours BETWEEN 0 AND 720),
    CONSTRAINT "practice_settings_reminder_check" CHECK (reminder_hours_before BETWEEN 1 AND 168)
);

-- CreateTable
CREATE TABLE "practice_pages" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "about" JSONB NOT NULL DEFAULT '{}',
    "directions" JSONB NOT NULL DEFAULT '{}',
    "show_services" BOOLEAN NOT NULL DEFAULT true,
    "show_team" BOOLEAN NOT NULL DEFAULT true,
    "show_opening_hours" BOOLEAN NOT NULL DEFAULT true,
    "show_directions" BOOLEAN NOT NULL DEFAULT true,
    "legal_notice_url" TEXT,
    "privacy_policy_url" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_pages_pkey" PRIMARY KEY ("id"),
    -- Hand-written: a singleton, text per locale.
    CONSTRAINT "practice_pages_id_check" CHECK (id = 1),
    CONSTRAINT "practice_pages_about_check" CHECK (jsonb_typeof(about) = 'object'),
    CONSTRAINT "practice_pages_directions_check" CHECK (jsonb_typeof(directions) = 'object')
);

-- CreateTable
CREATE TABLE "opening_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "weekday" SMALLINT NOT NULL,
    "opens_at" SMALLINT NOT NULL,
    "closes_at" SMALLINT NOT NULL,

    CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("id"),
    -- Hand-written: valid intervals, and no two of a weekday overlap.
    CONSTRAINT "opening_hours_weekday_check" CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT "opening_hours_interval_check" CHECK (opens_at >= 0 AND closes_at <= 1440 AND opens_at < closes_at),
    CONSTRAINT "opening_hours_no_overlap" EXCLUDE USING gist (weekday WITH =, int4range(opens_at, closes_at) WITH &&)
);

-- CreateTable
CREATE TABLE "special_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL,
    "opens_at" SMALLINT,
    "closes_at" SMALLINT,
    "label" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "special_days_pkey" PRIMARY KEY ("id"),
    -- Hand-written: closed, or valid hours.
    CONSTRAINT "special_days_hours_check" CHECK (
      (closed AND opens_at IS NULL AND closes_at IS NULL)
      OR (
        NOT closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL
        AND opens_at >= 0 AND closes_at <= 1440 AND opens_at < closes_at
      )
    ),
    CONSTRAINT "special_days_label_check" CHECK (jsonb_typeof(label) = 'object')
);

-- CreateTable
CREATE TABLE "practice_themes" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "preset" "theme_preset" NOT NULL DEFAULT 'TEAL',
    "custom_color" TEXT,
    "scale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "initials" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_themes_pkey" PRIMARY KEY ("id"),
    -- Hand-written: a singleton, and the colours are safe to put into CSS (05 §3.2).
    CONSTRAINT "practice_themes_id_check" CHECK (id = 1),
    CONSTRAINT "practice_themes_custom_color_check" CHECK (custom_color ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT "practice_themes_scale_check" CHECK (
      scale = ARRAY[]::TEXT[]
      OR (array_length(scale, 1) = 11 AND array_to_string(scale, ',') ~ '^(#[0-9a-f]{6},){10}#[0-9a-f]{6}$')
    ),
    CONSTRAINT "practice_themes_custom_check" CHECK (
      (preset = 'CUSTOM' AND custom_color IS NOT NULL AND coalesce(array_length(scale, 1), 0) = 11)
      OR (preset <> 'CUSTOM' AND custom_color IS NULL AND scale = ARRAY[]::TEXT[])
    ),
    CONSTRAINT "practice_themes_initials_check" CHECK (char_length(initials) <= 2)
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "duration_minutes" SMALLINT NOT NULL,
    "is_bookable_online" BOOLEAN NOT NULL DEFAULT true,
    "allowed_insurance_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id"),
    -- Hand-written: text per locale and the duration range.
    CONSTRAINT "services_name_check" CHECK (jsonb_typeof(name) = 'object'),
    CONSTRAINT "services_description_check" CHECK (jsonb_typeof(description) = 'object'),
    CONSTRAINT "services_duration_check" CHECK (duration_minutes BETWEEN 5 AND 480)
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "position" JSONB NOT NULL DEFAULT '{}',
    "is_provider" BOOLEAN NOT NULL DEFAULT false,
    "specialty" JSONB NOT NULL DEFAULT '{}',
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hidden_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id"),
    -- Hand-written: text per locale.
    CONSTRAINT "staff_members_position_check" CHECK (jsonb_typeof(position) = 'object'),
    CONSTRAINT "staff_members_specialty_check" CHECK (jsonb_typeof(specialty) = 'object')
);

-- CreateTable
CREATE TABLE "staff_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_member_id" UUID NOT NULL,
    "type" "staff_consent_type" NOT NULL,
    "text_version" TEXT NOT NULL,
    "given_at" TIMESTAMPTZ(3) NOT NULL,
    "withdrawn_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "special_days_date_key" ON "special_days"("date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_consents_active_key" ON "staff_consents"("staff_member_id", "type") WHERE (withdrawn_at IS NULL);

-- AddForeignKey
ALTER TABLE "staff_consents" ADD CONSTRAINT "staff_consents_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The static singleton rows; provisioning writes the time zone and the default locale.
INSERT INTO practice_settings (id, weekend_days) VALUES (1, ARRAY[6, 7]::SMALLINT[]);
INSERT INTO practice_pages (id) VALUES (1);
INSERT INTO practice_themes (id) VALUES (1);

COMMIT;
