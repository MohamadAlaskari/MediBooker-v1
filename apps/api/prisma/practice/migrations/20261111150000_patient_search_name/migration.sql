BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- M05, after its security review: a patient's name as the team's search compares it, kept in the
-- row. A search then reads it, instead of folding every patient's name again for every word it
-- has. The function folds as searchTextOf in patient-search.rules.ts does: lower case, NFD, without
-- Latin accents, tashkeel, superscript alef, madda, hamza and tatweel, with the wasla alef, alef
-- maqsura and ta marbuta written as alef, ya and ha, and single spaces; the integration tests
-- compare both. A trigger writes the column, so that no writer of a name can forget it.

CREATE FUNCTION patient_search_name(first_name TEXT, last_name TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT btrim(regexp_replace(regexp_replace(
    translate(normalize(lower(first_name || ' ' || last_name), NFD),
      U&'\0671\0649\0629', U&'\0627\064A\0647'),
    U&'[\0300-\036F\064B-\0655\0670\0640]', '', 'g'), '[[:space:]]+', ' ', 'g')) $$;

CREATE FUNCTION patients_set_search_name() RETURNS TRIGGER LANGUAGE plpgsql
  AS $$ BEGIN
    NEW.search_name := patient_search_name(NEW.first_name, NEW.last_name);
    RETURN NEW;
  END $$;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "search_name" TEXT NOT NULL DEFAULT '';

CREATE TRIGGER "patients_search_name"
  BEFORE INSERT OR UPDATE OF "first_name", "last_name", "search_name" ON "patients"
  FOR EACH ROW EXECUTE FUNCTION patients_set_search_name();

UPDATE "patients" SET "search_name" = patient_search_name("first_name", "last_name");

COMMIT;
