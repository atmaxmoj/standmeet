-- 2026-09-01 · 每-embed 的 Ed25519 凭据（widget 的 JWT 防盗）。
--
-- widget 的 JS 里放的是这把私钥，不是 access code；session 签发时按 JWT 的 kid（= key_id）
-- 反查公钥验签，再反查出 code 发会话——code 明文从不进客户端。设计见
-- wiki/.../key-designs/embed-credential-never-carries-the-code。
--
-- nullable：没 key 的 embed 退回明文 code 那条老路（向后兼容）；新建的 embed 一律带 key。
-- 幂等：ADD COLUMN IF NOT EXISTS + 唯一索引 IF NOT EXISTS（NULL 各不相同，无 key 的可共存）。

ALTER TABLE embeds ADD COLUMN IF NOT EXISTS key_id uuid;
ALTER TABLE embeds ADD COLUMN IF NOT EXISTS public_key text;
CREATE UNIQUE INDEX IF NOT EXISTS embeds_key_id_uniq ON embeds(key_id);
