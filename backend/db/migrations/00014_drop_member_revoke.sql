-- +goose Up

-- 之前 00010 给 code_members 加了 revoked 字段，本意是 owner 可以单独关掉
-- 某个 member 而不动整 code。重新审视聚合边界：CodeMember 是 AccessCode
-- 的子实体，不是独立 aggregate root；revoke 这种事务边界事件只应在
-- AccessCode 级别（code.status='revoked'）。
--
-- 这条迁移把 code_members.revoked 字段干掉；usecases 里相应的 ErrMemberRevoked
-- + RevokeCodeMember + 路由 + 前端 UI 一并清。

ALTER TABLE code_members DROP COLUMN IF EXISTS revoked;

-- +goose Down
ALTER TABLE code_members ADD COLUMN revoked boolean NOT NULL DEFAULT false;
