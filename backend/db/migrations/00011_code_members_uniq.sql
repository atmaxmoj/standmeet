-- +goose Up

-- code_members 的 (code_id, display_name) 唯一索引。00010 也加了一份
-- IF NOT EXISTS 版本（fresh apply 时建好），这条迁移给 00010 早已 applied
-- 但还没拿到这条索引的实例补建。GetOrCreateCodeMember 的 ON CONFLICT 依赖它。

CREATE UNIQUE INDEX IF NOT EXISTS code_members_code_name_uniq
    ON code_members(code_id, display_name);

-- +goose Down
DROP INDEX IF EXISTS code_members_code_name_uniq;
