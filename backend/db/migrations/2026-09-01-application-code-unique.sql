-- 2026-09-01 · 一张 access code 最多绑一个 application（access_code_id 唯一）。
--
-- 为什么：访客侧的简历工具靠 GetApplicationByAccessCode(:one) 按 session 的码反查"这一份"
-- application 的 resume_content。允许一张码绑两份 application 的话，:one 取到哪一份是未定义的 ——
-- 招聘官会话可能读到另一份 application 的简历。隔离建立在"一码一份"这个不变量上，所以它必须由
-- 约束保证，而不是靠 commit 每次恰好发新码这个约定（[[assertion-that-cannot-fail]] 同族）。
--
-- 不去重：application 是持久的、有价值的数据。commit 一贯为每份 application 发一张新码，历史上
-- 不存在重复 access_code_id —— 唯一索引直接建得起来。万一（不该发生地）真有重复，让 migration
-- 大声失败、由人来查，好过悄悄 DELETE 掉一份 application。embed 那条能去重是因为 embed 可再造，
-- application 不行。
--
-- 全新装的库上：DROP INDEX IF EXISTS 无害（schema.sql 里已经是唯一索引、这个非唯一名字不存在），
-- CREATE UNIQUE INDEX IF NOT EXISTS 命中已存在的唯一索引也无害。
--
-- 这是新增 migration，不改任何已有的（已在跑着的实例上打过 = 不可变）。

DROP INDEX IF EXISTS applications_access_code_idx;
CREATE UNIQUE INDEX IF NOT EXISTS applications_access_code_uniq ON applications(access_code_id);
