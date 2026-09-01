-- 2026-09-01 · embed widget：embeds 表（embed→code + 来源白名单）+ 码级每周期速率闸。
--
-- 为什么要 migration：v0.1.x 已发布，跑着的实例升级不走 schema.sql（那只在新卷上跑一次）。
-- 后端启动时 pgstore.Migrate 会把这个文件打上（编在二进制里）。
--
-- 幂等：CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS。重跑无害。
--
--   · embeds —— embed widget 配置。**embed 指向 code**（embeds.code_id），来源白名单住这儿。
--   · access_codes.limit_per_period —— 每周期自动回满的码级速率闸（turns/gas per period）。
--     NULL = 不限，对已有的码是无影响的安全默认。

CREATE TABLE IF NOT EXISTS embeds (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code_id          uuid          NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
    label            text          NOT NULL DEFAULT '',
    allowed_origins  jsonb         NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    updated_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS embeds_owner_idx ON embeds(owner_id);
CREATE INDEX IF NOT EXISTS embeds_code_idx ON embeds(code_id);

ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS limit_per_period jsonb;
