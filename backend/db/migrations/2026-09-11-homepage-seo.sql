-- homepage SEO — the site root's <title> / <meta description> / OG image, kept on the OWNER, not on
-- the `home` microsite row. The site root (/) is always a destination whether or not the owner has
-- materialized, built, or deleted a `home` page, so its SEO must survive that lifecycle — decoupled
-- from the microsite (a /p/<slug> page's SEO stays on its own row; only the homepage is special this
-- way). Empty = nothing emitted. Additive + idempotent: an upgrade of a live instance just adds the
-- columns and existing owners default to no homepage SEO.
ALTER TABLE owners ADD COLUMN IF NOT EXISTS homepage_seo_title text NOT NULL DEFAULT '';
ALTER TABLE owners ADD COLUMN IF NOT EXISTS homepage_seo_description text NOT NULL DEFAULT '';
ALTER TABLE owners ADD COLUMN IF NOT EXISTS homepage_seo_image text NOT NULL DEFAULT '';
