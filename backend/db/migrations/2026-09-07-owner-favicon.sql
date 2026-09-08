-- favicon —— the owner's chosen favicon, stored as a reference to an asset in the global pool
-- (asset_id), not the bytes. Empty = the product default. It is served at /favicon.ico from an
-- in-memory cache that the backend loads on boot and refreshes whenever the owner changes it, so the
-- per-request path never touches storage. Additive + idempotent, so an upgrade of a live instance
-- just adds the column (existing owners default to no custom favicon).
ALTER TABLE owners ADD COLUMN IF NOT EXISTS favicon_asset_id text NOT NULL DEFAULT '';
