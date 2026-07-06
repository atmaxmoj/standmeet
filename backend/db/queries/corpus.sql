-- corpus.sql —— raw_entries（未整理的摄入 inbox）的 query。raw 是独立表、不进统一 note 基座。
-- wiki / output 的 query 已归一到 corpus_notes.sql（genre 参数化）。

-- name: CreateRawEntry :one
INSERT INTO raw_entries (owner_id, body, source, source_meta, tags, flagged_private)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpsertRawFromVault :one
-- vault sync 幂等:同一 obsidian source 重传 → upsert(更新 body/tags),不 append 成重复行。
-- 靠 raw_entries_obsidian_source_uniq (partial: source LIKE 'obsidian:%') 做 conflict 推断。
INSERT INTO raw_entries (owner_id, body, source, source_meta, tags, flagged_private)
VALUES ($1, $2, $3, '{}'::jsonb, $4, false)
ON CONFLICT (owner_id, source) WHERE source LIKE 'obsidian:%'
DO UPDATE SET body = EXCLUDED.body, tags = EXCLUDED.tags
RETURNING *;

-- name: ListRawByOwner :many
SELECT * FROM raw_entries
WHERE owner_id = $1 AND archived = false
ORDER BY created_at DESC
LIMIT $2;

-- name: GetRawByID :one
SELECT * FROM raw_entries WHERE id = $1 AND owner_id = $2;

-- name: ArchiveRaw :exec
UPDATE raw_entries SET archived = true WHERE id = $1 AND owner_id = $2;

-- name: SetRawTags :exec
UPDATE raw_entries SET tags = $3 WHERE id = $1 AND owner_id = $2;

-- name: MarkRawPromoted :exec
UPDATE raw_entries SET promoted_to = $3 WHERE id = $1 AND owner_id = $2;

-- name: UpdateRawBody :one
-- admin "edit raw" 入口：改 body + tags + flagged_private。source 不动
-- （source 是 ingest 来源标签，编辑不该改）。
UPDATE raw_entries
SET body = $3, tags = $4, flagged_private = $5
WHERE id = $1 AND owner_id = $2
RETURNING *;
