-- +goose Up

-- 紧急 password reset 兜底：owner 忘了密码 → 服务器上 docker exec 跑
-- `standmeet password-reset` 子命令，颁发一次性 token (32-byte random)，
-- hash 落进 owners.password_reset_hash，30min 后失效。owner 用 plaintext
-- 进 /account/reset?t=... 改密码；用完清掉 hash。
--
-- 不存 plaintext：跟 setup_token / api_token 同套路。owner 看 stdout 拷 URL。
ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS password_reset_hash bytea NOT NULL DEFAULT ''::bytea;
ALTER TABLE owners
  ADD COLUMN IF NOT EXISTS password_reset_at timestamptz;

-- +goose Down
ALTER TABLE owners DROP COLUMN IF EXISTS password_reset_at;
ALTER TABLE owners DROP COLUMN IF EXISTS password_reset_hash;
