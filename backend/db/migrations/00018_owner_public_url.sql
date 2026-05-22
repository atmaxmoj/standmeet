-- +goose Up

-- 删 PUBLIC_URL env 把"对外是谁"集中到 owners 行（admin 可改、claim 必填）。
--
-- 原 custom_domain (citext) 设计是给 Caddy on-demand TLS 用的 bare domain，
-- 但从来没接通。新场景要的是完整 URL（scheme + host + port，dev 要 :38127）。
-- 重命名为 public_url + 切 text 表达"完整 URL"的语义。
--
-- custom_domain_status (TLS 状态) 跟着删 —— Caddy 集成落地时再加回来；
-- YAGNI 期间挂着只会被误用。
-- DROP IF EXISTS + ADD IF NOT EXISTS：在 dev / e2e 反复重置 schema 时容错
-- （手动 ALTER 过、镜像里又跑 goose 的场景）。production 路径只跑一次，
-- IF EXISTS 没副作用。
ALTER TABLE owners DROP COLUMN IF EXISTS custom_domain;
ALTER TABLE owners DROP COLUMN IF EXISTS custom_domain_status;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS public_url text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE owners DROP COLUMN IF EXISTS public_url;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS custom_domain citext UNIQUE;
ALTER TABLE owners ADD COLUMN IF NOT EXISTS custom_domain_status text NOT NULL DEFAULT 'unset';
