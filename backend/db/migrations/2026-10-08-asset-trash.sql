-- 2026-10-08-asset-trash.sql — a file deleted from the asset pool waits in the trash for 90 days.
-- Reentrant: safe to run on a database that already has it.
--
-- An uploaded file is an owner asset (owner, 2026-10-08: "资产而非配置的,都想要软删除").
-- assets.pool_delete now sets deleted_at and keeps the blob; every read filters it (a trashed file
-- is not served); restore clears it; a daily job drops the blob and the row 90 days on. The
-- reference guard is unchanged: a file something still uses cannot be deleted at all.
-- events: none (an asset change is carried by the entry or page that references it)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS assets_trash_idx ON assets(owner_id, deleted_at) WHERE deleted_at IS NOT NULL;
