-- 2026-08-25-obsidian-frontmatter —— 存下每条笔记在 vault 里那一块 frontmatter 的原文。
--
-- 为什么（F-L-67）：产品只认识十来个 frontmatter key，真 vault 上还写着 `langs`（596 篇）、
-- `aliases-zh`（595 篇）、`owns`（33 篇）。解析时忽略未知 key 是对的，但导出侧因此无从写回 ——
-- owner 同步一次就把它们从自己的库里删了。存原文同时保住了形态（内联数组 / 键序），
-- 那是在一个 git 管着的 vault 里避免每次同步都产生假 diff 的条件。
--
-- ── 升级场景（这一条为什么这么写）────────────────────────────────────────────────────
-- 这一句跑在**已经装满数据**的实例上：一台跑了几个月的 instance，corpus_notes 里可能有几千行。
--
--   · `ADD COLUMN ... NOT NULL DEFAULT ''` 在 PG 11+ 上不重写整张表（默认值存元数据里），
--     所以它不会因为表大而长时间持锁 —— 这是选这个写法而不是「先加可空列再回填」的原因。
--   · `IF NOT EXISTS`：这份 migration 可能被跑第二次（两个库各打一次、或者一次失败后重跑），
--     第二次必须是空操作而不是报错。
--   · 老行拿到空串，而空串正是「这条笔记没有来自 vault 的 frontmatter」的语义 —— 导出对它
--     照旧按字段渲染，也就是升级前的行为。**升级本身不改变任何现有笔记的导出结果**，
--     新行为只在下一次 sync 把原文存进来之后才生效。
--
-- 验证：backend/db/schema.sql 已同步；两个库各跑一次后 `make schema-drift` 两侧都要 in sync。

ALTER TABLE corpus_notes
  ADD COLUMN IF NOT EXISTS obsidian_frontmatter text NOT NULL DEFAULT '';
