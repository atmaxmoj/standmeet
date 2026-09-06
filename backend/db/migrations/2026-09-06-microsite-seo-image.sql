-- 2026-09-06-microsite-seo-image.sql — the Open Graph / share-card image for per-page SEO. When
-- a microsite's link is shared (social, chat), this is the preview image (og:image, twitter:image).
--
-- Nullable, no default: a page without one simply emits no image meta. IF NOT EXISTS makes it a
-- no-op on a fresh install (schema.sql already has the column) and safe to re-run.
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS seo_image text;
