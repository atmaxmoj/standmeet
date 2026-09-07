-- Add the Puck editor's own state JSON to résumé drafts (nullable).
--
-- Editor fidelity only: resume_content stays the canonical render source (typst renders from it),
-- and puck_data is always rederivable from resume_content via toPuckData — never a second source of
-- truth. Existing drafts (agent-created via MCP, or pre-Puck) have NULL puck_data and open fine: the
-- Puck editor derives it from resume_content on open, and adopts puck_data on the first Save.
--
-- Reentrant: safe to re-run against a DB already in the new shape.
ALTER TABLE resume_drafts ADD COLUMN IF NOT EXISTS puck_data jsonb;
