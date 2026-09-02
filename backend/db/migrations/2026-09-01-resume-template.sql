-- 2026-09-01 · resume 定制化：草稿选哪个 Typst 排版。
--
-- resume PDF 现在走 Typst（internal/owner/jobs/resumepdf），owner 可选模板（classic / compact / …）。
-- 选择存在草稿上，commit 时带进渲染。NOT NULL DEFAULT '' → 老草稿走默认 classic，无影响。
-- 幂等：ADD COLUMN IF NOT EXISTS。

ALTER TABLE resume_drafts ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT '';
