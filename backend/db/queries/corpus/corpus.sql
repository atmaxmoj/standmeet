-- corpus.sql —— raw inbox 的 query。raw 已折进统一 corpus_notes 基座（genre='raw'，#151），
-- 不再是独立表。inbox 专属字段（inbox_source / inbox_meta / flagged_private / archived /
-- promoted_to）只对 genre='raw' 有意义。列映射:body→body, source→inbox_source,
-- source_meta→inbox_meta, tags→tags。title NOT NULL,每条 INSERT 必给。

-- name: CreateRawEntry :one
-- MCP raw_dump: title 由 caller 从 body 派生(首行 <=60 char,fallback "untitled")。
INSERT INTO corpus_notes (owner_id, genre, title, body, inbox_source, inbox_meta, tags, flagged_private)
VALUES ($1, 'raw', $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListRawByOwner :many
-- archived 这一列不再有写者:raw 的删跟 wiki / output 一样是真删(见 RawRepo.Delete)。
-- 过滤留着,是因为老库里可能还有当年归档下来的行 —— 它们当时就已经从每个列表消失了,
-- 现在也不该突然冒出来。
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = 'raw' AND archived = false
ORDER BY created_at DESC
LIMIT $2;

-- name: GetRawByID :one
SELECT * FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = 'raw';

-- name: SetRawTags :exec
UPDATE corpus_notes SET tags = $3 WHERE id = $1 AND owner_id = $2 AND genre = 'raw';

-- name: MarkRawPromoted :exec
UPDATE corpus_notes SET promoted_to = $3 WHERE id = $1 AND owner_id = $2 AND genre = 'raw';

-- name: UpdateRawBody :one
-- admin "edit raw" 入口：改 body + tags + flagged_private。inbox_source 不动
-- （inbox_source 是 ingest 来源标签，编辑不该改）。
UPDATE corpus_notes
SET body = $3, tags = $4, flagged_private = $5
WHERE id = $1 AND owner_id = $2 AND genre = 'raw'
RETURNING *;
