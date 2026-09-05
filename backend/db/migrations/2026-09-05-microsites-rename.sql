-- 2026-09-05-microsites-rename.sql — rename "custom pages" → "microsites" (jargon unification) and
-- add the per-microsite write gate (store_writable).
--
-- Guarded so it is safe on BOTH paths:
--   · upgrade (an existing instance still has custom_pages): the DO block renames the tables,
--     their indexes, the access_codes.custom_page_id column, its FK constraint, and the index on it.
--   · fresh install (schema.sql already created `microsites`): custom_pages does not exist, so the
--     block is skipped. Re-running is a no-op (custom_pages is gone after the first run).
--
-- The index/constraint names matter, not just the table: the repo detects a slug collision by the
-- unique-index name (microsites_owner_slug_idx), so the live index must be renamed to match.

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'custom_pages') THEN
    ALTER TABLE custom_pages RENAME TO microsites;
    ALTER TABLE custom_page_builds RENAME TO microsite_builds;
    ALTER INDEX custom_pages_owner_slug_idx RENAME TO microsites_owner_slug_idx;
    ALTER TABLE access_codes RENAME COLUMN custom_page_id TO microsite_id;
    ALTER INDEX access_codes_custom_page_idx RENAME TO access_codes_microsite_idx;
    ALTER TABLE access_codes
      RENAME CONSTRAINT access_codes_custom_page_id_fkey TO access_codes_microsite_id_fkey;
  END IF;
END $$;

-- store_writable — whether visitors may WRITE this microsite's data store (security model C).
-- Default false: zero write attack surface until the owner opens it. Reads are ungated. On a fresh
-- install the column already exists (schema.sql), so IF NOT EXISTS makes this a no-op there.
ALTER TABLE microsites ADD COLUMN IF NOT EXISTS store_writable boolean NOT NULL DEFAULT false;
