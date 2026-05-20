-- +goose Up

-- 00012 把 ai_provider enum 写成 ('mock','anthropic','openai') + default 'mock'。
-- 后来想清楚 mock 是 e2e fixture，不该是 owner pick 出来的选项；prod 行只
-- 能在 anthropic / openai 里选。这条迁移：
--   1. 把已有的 'mock' 行回退成 'anthropic'（默认状态，key 还是空 → chat 直接报"未配置"）。
--   2. CHECK 限制收紧到 ('anthropic', 'openai')。
--   3. default 改 'anthropic'。

UPDATE owners SET ai_provider = 'anthropic' WHERE ai_provider = 'mock';

ALTER TABLE owners ALTER COLUMN ai_provider SET DEFAULT 'anthropic';

ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_ai_provider_check;
ALTER TABLE owners ADD CONSTRAINT owners_ai_provider_check
    CHECK (ai_provider IN ('anthropic', 'openai'));

-- +goose Down
ALTER TABLE owners DROP CONSTRAINT IF EXISTS owners_ai_provider_check;
ALTER TABLE owners ADD CONSTRAINT owners_ai_provider_check
    CHECK (ai_provider IN ('mock', 'anthropic', 'openai'));
ALTER TABLE owners ALTER COLUMN ai_provider SET DEFAULT 'mock';
