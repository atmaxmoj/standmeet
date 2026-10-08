-- 2026-10-08-resume-master-trash.sql — a deleted résumé master waits in the trash for 90 days.
-- Reentrant: safe to run on a database that already has it.
--
-- A master is an asset (the owner's own résumé), not configuration (owner, 2026-10-08: "资产而非配置的,
-- 都想要软删除"). resume.master_delete now sets deleted_at; every read filters it; restore clears it;
-- a daily job drops rows deleted more than 90 days ago. A soft column, not the corpus trash's
-- triggers: the table has seven readers, all in one queries file.
--
-- The one-default index counts live masters only: a trashed master gives up being the default when
-- it is deleted, and a restored one comes back as a plain master.
-- events: none (owner content outside the corpus)
ALTER TABLE resume_masters ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
DROP INDEX IF EXISTS resume_masters_one_default;
CREATE UNIQUE INDEX IF NOT EXISTS resume_masters_one_default
    ON resume_masters(owner_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS resume_masters_trash_idx
    ON resume_masters(owner_id, deleted_at) WHERE deleted_at IS NOT NULL;
