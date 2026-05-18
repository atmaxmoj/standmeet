-- +goose Up

-- 扩展 conversations.tier 接收 'public'，让 BYOAI-public 访客
-- （无 code，公开 visibility 切片）也能落 conversation。
ALTER TABLE conversations DROP CONSTRAINT conversations_tier_check;
ALTER TABLE conversations
    ADD CONSTRAINT conversations_tier_check
    CHECK (tier IN ('code', 'byoai', 'public'));

-- page_content —— owner public page 的内容（hero / insights / projects / where /
-- contact）。Singleton-per-owner：UNIQUE(owner_id) 让一个 owner 只能有一行；
-- 不存在时 backend 返默认值，admin 第一次 PUT 时插入。
-- 各 section 用 jsonb 存 schemaless 结构，前端 + admin schema 演进不卡 migration。
CREATE TABLE page_content (
    owner_id        uuid          PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    hero_prose      text          NOT NULL DEFAULT '',
    hero_examples   jsonb         NOT NULL DEFAULT '[]'::jsonb,
    insights        jsonb         NOT NULL DEFAULT '[]'::jsonb,
    projects        jsonb         NOT NULL DEFAULT '[]'::jsonb,
    where_section   jsonb         NOT NULL DEFAULT '{}'::jsonb,
    contact         jsonb         NOT NULL DEFAULT '{}'::jsonb,
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS page_content;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_tier_check;
ALTER TABLE conversations
    ADD CONSTRAINT conversations_tier_check
    CHECK (tier IN ('code', 'byoai'));
