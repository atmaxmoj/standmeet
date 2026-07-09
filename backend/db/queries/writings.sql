-- writings.sql —— owner 公开发表的"作品"（genre='writing'）的 query。writing 已折进统一
-- corpus_notes 基座（#151），不再是独立 writings 表。列映射：body_md→body，slug/visibility/
-- locked_body/cover_*/read_minutes/cross_refs/published_at 是 corpus_notes 上只对 genre='writing'
-- 有意义的专属列；path **不存**（派生 "writings/"+slug）；obsidian 元数据复用共享列。
-- 每条 query 都限定 genre='writing'，跟其它 genre 隔离。

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
-- retriever corpus_read 按 slug 读 published writing（path 派生 "writings/"+slug，
-- 故只需 slug，DB 不走内存窗口）。
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND slug = $2 AND genre = 'writing' AND published_at IS NOT NULL;

-- name: SearchPublishedWritings :many
-- retriever corpus_search 全量搜 published writing(DB full-text,镜像 wiki/output:
-- 自然语言问句按 OR 命中任一词项,ts_rank 排序),不吃内存窗口。
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
-- 分页 infinite scroll：cursor = 上一页最末 writing.published_at (RFC3339)，
-- 第一页 cursor 传 NULL 拿最新 N 条。返 LIMIT+1 让 caller 判断 has_more。
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing'
  AND published_at IS NOT NULL
  AND ($2::timestamptz IS NULL OR published_at < $2::timestamptz)
ORDER BY published_at DESC
LIMIT $3;

-- name: SetWritingObsidianMeta :exec
-- Obsidian import 走完 SaveWriting 之后调用：标记这行 writing 是从 vault
-- 来的，顺便记 imported_at = now()。re-import 时根据 updated_at vs imported_at
-- 决定 skip / overwrite（owner 在 web 改过了 updated_at 会跳过 imported_at）。
UPDATE corpus_notes
SET obsidian_source_path = $3,
    obsidian_imported_at = now(),
    updated_at = now()
WHERE id = $1 AND owner_id = $2 AND genre = 'writing';

-- name: GetWritingByObsidianSourcePath :one
SELECT * FROM corpus_notes
WHERE owner_id = $1 AND obsidian_source_path = $2 AND genre = 'writing';

-- name: ListPublishedWritingSlugAndTitle :many
-- /writings 渲染 [[crosslink]] 时用：拉 owner 所有 published writing 的
-- slug + title 当 resolution index，不带 body（避免 N+1 那种全 body 重传开销）。
SELECT slug, title
FROM corpus_notes
WHERE owner_id = $1 AND genre = 'writing' AND published_at IS NOT NULL
ORDER BY slug ASC;
