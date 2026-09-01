-- 2026-09-01 · 一张码最多被一个 embed 暴露（code_id 唯一）。
--
-- 为什么：来源白名单住在 embed 上，而 session 签发时靠 GetEmbedForCode(:one) 按码取白名单。
-- 允许一张码挂两个 embed 的话，两份白名单里到底哪一份生效是未定义的（:one 取到的那一份）——
-- owner 在第二个 embed 上设了更严的白名单，实际却是第一个的宽白名单在放行。白名单是安全边界，
-- 不能有"设了却不生效"的那一份（[[names-that-lie]]）。想给两个站两份白名单，就发两张码。
--
-- 幂等：先去重（每张码留一个，keep 最早的 ctid），再把非唯一索引换成唯一索引。
-- 全新装的库上这段 DELETE 命中 0 行、DROP INDEX IF EXISTS 无害。
--
-- 这是**第二个** migration，不改上一个（上一个已在跑着的实例上打过 = 不可变）。

DELETE FROM embeds a USING embeds b
  WHERE a.code_id = b.code_id AND a.ctid > b.ctid;

DROP INDEX IF EXISTS embeds_code_idx;
CREATE UNIQUE INDEX IF NOT EXISTS embeds_code_uniq ON embeds(code_id);
