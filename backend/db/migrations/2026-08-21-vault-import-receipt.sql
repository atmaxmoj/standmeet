-- 2026-08-21 · UX-62：给 vault 导入一个回执。
--
-- schema.sql 只在**全新的 pg 卷**上跑一次，所以已经在跑的实例要走这里的 ALTER
-- （[[schema-lives-in-the-volume-not-the-image]]）。全部可重入、非破坏性。
--
-- NULL 的 last_vault_import_at = 从没导过。**不拿 0 当哨兵**：「导过但零变更」和
-- 「从没导过」是两件事，而把它们说成同一句，正是这条缺陷本身。

ALTER TABLE owners ADD COLUMN IF NOT EXISTS last_vault_import_at      timestamptz;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS last_vault_import_new     integer NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS last_vault_import_updated integer NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS last_vault_import_skipped integer NOT NULL DEFAULT 0;
