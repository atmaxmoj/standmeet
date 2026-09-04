-- writings.sql —— queries for the owner's publicly published "works" (genre='writing'). writing is folded into
-- the unified corpus_notes base (#151), no longer its own writings table. Column mapping: body_md→body; slug/
-- visibility/locked_body/cover_*/read_minutes/cross_refs/published_at are dedicated columns on corpus_notes that
-- only matter for genre='writing'; path is **not stored** (derived as "writings/"+slug); obsidian metadata reuses
-- the shared columns. Every query limits to genre='writing', isolating it from the other genres.

-- name: CreateWriting :one
INSERT INTO corpus_notes (
    owner_id, genre, slug, title, excerpt, body,
    cover_headline, cover_hue, cover_image_asset_id,
    tags, visibility, cross_refs, read_minutes, locked_body,
    published_at, parent_id, published
) VALUES (
    $1, 'writing', $2, $3, $4, $5,
    $6, $7, $8,
    $9, $10, $11, $12, $13,
    $14, $15, $16
)
RETURNING *;

-- name: UpdateWriting :one
UPDATE corpus_notes SET
    title = $3, excerpt = $4, body = $5,
    cover_headline = $6, cover_hue = $7, cover_image_asset_id = $8,
    tags = $9, visibility = $10, cross_refs = $11,
    read_minutes = $12, locked_body = $13, parent_id = $14,
    updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = 'writing'
RETURNING *;

-- name: PublishWriting :one
UPDATE corpus_notes SET published_at = now(), published = true, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = 'writing'
RETURNING *;

-- name: UnpublishWriting :one
UPDATE corpus_notes SET published_at = NULL, published = false, updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = 'writing'
RETURNING *;

-- name: DeleteWriting :exec
DELETE FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = 'writing';

-- name: GetWritingByID :one
SELECT * FROM corpus_notes WHERE id = $1 AND owner_id = $2 AND genre = 'writing';

-- name: GetWritingBySlug :one
SELECT * FROM corpus_notes WHERE owner_id = $1 AND slug = $2 AND genre = 'writing';

-- name: GetPublishedWritingBySlug :one
-- retriever corpus_read reads a published writing by slug (path is derived as "writings/"+slug,
-- so only slug is needed; the DB does not use an in-memory window).
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND slug = $2 AND genre = 'writing' AND published_at IS NOT NULL;

-- name: SearchPublishedWritings :many
-- retriever corpus_search does a full search over published writings (DB full-text, mirroring wiki/output:
-- a natural-language question matches any term via OR, ranked by ts_rank), without an in-memory window.
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing' AND published_at IS NOT NULL
  AND to_tsvector('english', title || ' ' || body || ' ' || array_to_string(tags, ' '))
      @@ replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery
ORDER BY ts_rank(
        to_tsvector('english', title || ' ' || body || ' ' || array_to_string(tags, ' ')),
        replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery
      ) DESC, published_at DESC
LIMIT $3 OFFSET $4;

-- name: ListWritingsByOwner :many
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing'
ORDER BY COALESCE(published_at, created_at) DESC;

-- name: ListPublishedWritingsByOwner :many
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing' AND published_at IS NOT NULL
ORDER BY published_at DESC;

-- name: ListPublishedWritingsByOwnerPage :many
-- Paginated infinite scroll: cursor = the previous page's last writing.published_at (RFC3339);
-- the first page passes NULL as cursor to get the newest N. Returns LIMIT+1 so the caller can tell has_more.
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing'
  AND published_at IS NOT NULL
  AND ($2::timestamptz IS NULL OR published_at < $2::timestamptz)
ORDER BY published_at DESC
LIMIT $3;

-- name: SetWritingObsidianMeta :exec
-- Called after Obsidian import finishes SaveWriting: mark this writing row as coming from the
-- vault, and record imported_at = now(). On re-import, updated_at vs imported_at decides
-- skip / overwrite (if the owner edited it on the web, updated_at is newer than imported_at, so it is skipped).
UPDATE corpus_notes
SET obsidian_source_path = $3,
    obsidian_imported_at = now(),
    updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = 'writing';

-- name: GetWritingByObsidianSourcePath :one
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND obsidian_source_path = $2 AND genre = 'writing';

-- name: ListPublishedWritingSlugAndTitle :many
-- Used when /writings renders [[crosslink]]: pull the owner's all published writings'
-- slug + title as a resolution index, without body (to avoid the N+1-style cost of resending every full body).
SELECT slug, title
FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing' AND published_at IS NOT NULL
ORDER BY slug ASC;
