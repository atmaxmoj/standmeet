-- +goose Up

-- visitor chat retrieval 接 output 层：assistant message 引用的 output_ids
-- 跟 cited_wiki_ids 平行落盘。output 是 raw → wiki → output 三层中最精炼
-- 那层（可在对话里完整原样引用的成品），grounding 时优先级高于 wiki。
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS cited_output_ids uuid[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE messages DROP COLUMN IF EXISTS cited_output_ids;
