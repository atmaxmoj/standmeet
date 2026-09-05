-- 2026-08-23 · 一张码可以绑一个自定义页；一页可以自己决定要不要给 BYOK。
--
-- schema.sql 只在**全新的 pg 卷**上跑一次，所以已经在跑的实例走这里的 ALTER
-- （[[schema-lives-in-the-volume-not-the-image]]）。可重入、非破坏性。
-- 写下来就会被跑：后端启动时自己打（`pgstore.Migrate`）。存疑时 `make schema-drift` 自证。
--
-- 页面是这张码的一个**渲染** —— 授权、配额、身份、记账全不变，只换读者看到的样子。
-- 所以绑定是码上的一列，不是一张关系表：一张码至多一页，绑定是一个事实，
-- 两个面板都读它，谁也不存第二份。
--
-- ON DELETE SET NULL —— 页删了，码退回默认落地（访客对话），而不是跟着一起失效。

ALTER TABLE microsites ADD COLUMN IF NOT EXISTS allow_byoai boolean NOT NULL DEFAULT false;

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS microsite_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'access_codes_microsite_id_fkey'
    ) THEN
        ALTER TABLE access_codes
            ADD CONSTRAINT access_codes_microsite_id_fkey
            FOREIGN KEY (microsite_id) REFERENCES microsites(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS access_codes_microsite_idx ON access_codes(microsite_id);
