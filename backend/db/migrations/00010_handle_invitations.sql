-- +goose Up

-- handle_aliases —— owner 改 handle 后旧 handle 入这张表，让旧 URL 还能
-- resolve 到同一个 owner。lookup 路径：owners.handle 优先，未命中再 alias。
CREATE TABLE handle_aliases (
    handle      citext        PRIMARY KEY,
    owner_id    uuid          NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX handle_aliases_owner_idx ON handle_aliases(owner_id);

-- access_codes 加配额 + 扩 status enum
--   max_sessions_per_member = 每个 panel member 允许的 session 总数（"5 轮面试" = 5）
--   max_turns_per_session = 每个 session 内允许的 turn 上限（"每轮 10 个回合"）
ALTER TABLE access_codes
    ADD COLUMN max_sessions_per_member integer,
    ADD COLUMN max_turns_per_session    integer;

ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_status_check;
ALTER TABLE access_codes ADD CONSTRAINT access_codes_status_check
    CHECK (status IN ('active', 'revoked'));

-- code_members 已存在，加 revoked 字段（admin 可以封单个 member 而不动整 code）
ALTER TABLE code_members
    ADD COLUMN revoked boolean NOT NULL DEFAULT false;

-- 同一个 code 下，display_name 唯一 —— IdentityPicker 输入名字时按 (code,name)
-- upsert 出 member，再用 member_id 起 session / 查配额。
-- IF NOT EXISTS: 00011 也会再补一遍，让中途升级的实例也能拿到（00010 在新
-- 实例 fresh apply 时建好，老实例 00010 已 applied 时由 00011 补建）。
CREATE UNIQUE INDEX IF NOT EXISTS code_members_code_name_uniq
    ON code_members(code_id, display_name);

-- +goose Down
DROP INDEX IF EXISTS code_members_code_name_uniq;
ALTER TABLE code_members
    DROP COLUMN IF EXISTS revoked;
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_status_check;
ALTER TABLE access_codes ADD CONSTRAINT access_codes_status_check
    CHECK (status IN ('active'));
ALTER TABLE access_codes
    DROP COLUMN IF EXISTS max_turns_per_session,
    DROP COLUMN IF EXISTS max_sessions_per_member;
DROP TABLE IF EXISTS handle_aliases;
