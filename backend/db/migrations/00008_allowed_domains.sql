-- +goose Up

-- allowed_domains —— Caddy on-demand TLS 白名单。GET /internal/tls-ask?domain=X
-- 在这里命中才返 200，让 Caddy 给 X 签证书。手动 admin 添加；setup 自动
-- 把 PUBLIC_URL 的 host 进来作为 instance 默认 domain。
--
-- jsonb 数组而非单独 table：domain 不多（一个 owner 通常 1-3 个域名），
-- 用 instance_settings 同行存查询最简单（一次 GetInstanceSettings 拿到）。

ALTER TABLE instance_settings
    ADD COLUMN allowed_domains jsonb NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE instance_settings DROP COLUMN IF EXISTS allowed_domains;
