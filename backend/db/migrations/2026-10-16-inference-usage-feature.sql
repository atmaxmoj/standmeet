-- 2026-10-16-inference-usage-feature.sql —— which feature spent each usage row.
--
-- feature: 'chat:<role>' for a visitor turn (every call the turn made, the ghost policy call too),
-- 'block:<plugin>' for a plugin's host generation. '' = a row written before this column existed.
-- The owner's MCP reads the 7-day totals per feature × model (instance.inference_usage.by_feature).

ALTER TABLE inference_usage ADD COLUMN IF NOT EXISTS feature text NOT NULL DEFAULT '';
