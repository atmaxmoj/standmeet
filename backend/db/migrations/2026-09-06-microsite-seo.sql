-- 2026-09-06-microsite-seo.sql — per-page SEO: each microsite carries its own seo_title +
-- seo_description, injected into the served page's <head>. SEO follows each microsite rather than
-- living in a global settings section.
--
-- Nullable, no default: an existing page (or one the owner never sets SEO on) injects nothing and
-- the built page keeps whatever <title> it has. IF NOT EXISTS makes it a no-op on a fresh install
-- (schema.sql already has the columns) and safe to re-run.
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS seo_description text;
