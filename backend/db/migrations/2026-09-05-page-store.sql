-- 2026-09-05-page-store.sql — per-custom-page persistence, security model C.
--
-- A custom page's data does NOT live in a shared table. Each page gets its OWN Postgres schema
-- (page_<id>, the capstore pattern) — physical isolation, created on page create, DROP SCHEMA
-- CASCADE on page delete. So the only thing this migration adds to core is the write gate:
-- store_writable = whether visitors may WRITE this page's store. Default false — a page has zero
-- write attack surface until its owner explicitly opens it. Reads are ungated. Idempotent.

ALTER TABLE custom_pages ADD COLUMN IF NOT EXISTS store_writable boolean NOT NULL DEFAULT false;
