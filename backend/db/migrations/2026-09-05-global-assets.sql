-- 2026-09-05-global-assets.sql — assets become a global pool + asset_references
-- (docs/design/global-assets.md).
--
-- Upgrade path for an existing instance whose assets are holder-owned corpus
-- images: give each asset an owner_id (from its holder note), seed a 'corpus'
-- reference so today's covers/body-images are preserved as live references, and
-- make holder_id nullable. A fresh install gets the new shape from schema.sql.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_id uuid;

-- backfill owner from each asset's holder note (holder_id was the corpus_notes id).
UPDATE assets a
   SET owner_id = n.owner_id
  FROM corpus_notes n
 WHERE a.owner_id IS NULL AND a.holder_id = n.id;

-- any asset whose holder no longer resolves is dead data (unreachable); drop the
-- row so owner_id can be NOT NULL. Its MinIO blob is left in place (invisible).
DELETE FROM assets WHERE owner_id IS NULL;

ALTER TABLE assets ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE assets ALTER COLUMN holder_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets(owner_id);

CREATE TABLE IF NOT EXISTS asset_references (
    asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    referrer_kind text NOT NULL,
    referrer_id   uuid NOT NULL,
    PRIMARY KEY (asset_id, referrer_kind, referrer_id)
);
CREATE INDEX IF NOT EXISTS asset_references_referrer_idx
    ON asset_references(referrer_kind, referrer_id);

-- preserve today's holder-owned images as corpus references from day one.
INSERT INTO asset_references (asset_id, referrer_kind, referrer_id)
SELECT id, 'corpus', holder_id FROM assets WHERE holder_id IS NOT NULL
ON CONFLICT DO NOTHING;
