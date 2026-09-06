-- 2026-09-06-access-code-slug.sql — each access code gets its own public landing path `slug`
-- (`/<slug>`), distinct from the raw code. A visitor with ?code= is bounced to /<slug>, so the code
-- never sits in the URL and the landing is a real path, not bare `/`. Unique per owner (like
-- microsite slugs). The slug is a LOCATOR, not a credential.
--
-- Upgrade path (existing instances have codes with no slug): add the column nullable, backfill each
-- row with a distinct short id derived from its uuid (guaranteed unique, so the unique index below
-- can be created), then make it NOT NULL. New codes get a snowflake-derived slug from the app.
-- IF NOT EXISTS everywhere so it's a no-op on a fresh install (schema.sql already has it) + re-runnable.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS slug citext;
UPDATE access_codes SET slug = left(replace(id::text, '-', ''), 12) WHERE slug IS NULL;
ALTER TABLE access_codes ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_codes_owner_slug_idx ON access_codes (owner_id, slug);
