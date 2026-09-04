-- corpus.sql —— queries for the raw inbox. raw is folded into the unified corpus_notes base
-- (genre='raw', #151), no longer its own table. The inbox-only fields (inbox_source / inbox_meta /
-- flagged_private / archived / promoted_to) only matter for genre='raw'. Column mapping: body→body,
-- source→inbox_source, source_meta→inbox_meta, tags→tags. title is NOT NULL, so every INSERT must set it.

-- name: CreateRawEntry :one
-- MCP raw_dump: the caller derives title from body (first line, <=60 chars, fallback "untitled").
INSERT INTO corpus_notes (owner_id, genre, title, body, inbox_source, inbox_meta, tags, flagged_private)
VALUES ($1, 'raw', $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListRawByOwner :many
-- The archived column no longer has any writer: deleting raw is a hard delete, same as wiki / output
-- (see RawRepo.Delete). The filter stays because an old database may still hold rows archived back then
-- —— they had already disappeared from every list at the time, and should not suddenly reappear now.
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
-- admin "edit raw" entry point: change body + tags + flagged_private. inbox_source is left untouched
-- (inbox_source is the ingest-source tag, which editing should not change).
UPDATE corpus_notes
SET body = $3, tags = $4, flagged_private = $5
WHERE id = $1 AND owner_id = $2 AND genre = 'raw'
RETURNING *;
