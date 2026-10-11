-- 2026-10-11-installed-blocks-integrity.sql — installed blocks remember where they came from and,
-- for a marketplace package, the contents the owner approved (job-loop roadmap 7.2.a). Reentrant.
-- Existing rows were all pasted by the owner: origin 'owner', no integrity.
ALTER TABLE installed_blocks ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'owner';
ALTER TABLE installed_blocks ADD COLUMN IF NOT EXISTS integrity text NOT NULL DEFAULT '';
