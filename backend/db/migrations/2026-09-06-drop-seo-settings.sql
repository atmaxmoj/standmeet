-- 2026-09-06-drop-seo-settings.sql — remove the owner-wide SEO settings table. SEO now follows
-- each microsite (per-page seo_title / seo_description / seo_image), not a global settings section,
-- so site_title / index_robots / sitemap_extras / og_template have no home any more. robots.txt is
-- allow-when-claimed (a claimed instance with a public URL is indexable); the site-wide default
-- SEO is simply the homepage microsite's own per-page SEO.
--
-- IF EXISTS makes it a no-op on a fresh install (schema.sql no longer creates the table) and safe
-- to re-run.
DROP TABLE IF EXISTS seo_settings;
