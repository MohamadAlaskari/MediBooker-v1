BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- P01: the practice's public name and its publication, in the registry so that an unpublished
-- practice answers 404 before any practice client is leased (02 §5).

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "name" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
-- Hand-written: text per locale (02 §9).
ADD CONSTRAINT "practices_name_check" CHECK (jsonb_typeof(name) = 'object');

-- The API's only update right on the registry: routing, status and secret references stay with
-- medibooker-db (ADR 0005 §4.4).
GRANT UPDATE (name, published_at, updated_at) ON practices TO platform_app;

-- Since P02 a slug decides which practice a public request reaches. The API may add a slug and
-- retire one, but never repoint or delete one, so a retired slug stays a tombstone (RT-14).
REVOKE UPDATE, DELETE ON practice_slugs FROM platform_app;
GRANT UPDATE (retired_at) ON practice_slugs TO platform_app;

COMMIT;
