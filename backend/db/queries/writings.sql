-- name: CreateWriting :one
INSERT INTO writings (
    owner_id, slug, title, excerpt, body_md,
    cover_headline, cover_sub, cover_hue, cover_image_asset_id,
    tags, visibility, cross_refs, path, read_minutes, locked_body,
    published_at, parent_id
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13, $14, $15,
    $16, $17
)
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, parent_id, created_at, updated_at;

-- name: UpdateWriting :one
UPDATE writings SET
    title = $3, excerpt = $4, body_md = $5,
    cover_headline = $6, cover_sub = $7, cover_hue = $8, cover_image_asset_id = $9,
    tags = $10, visibility = $11, cross_refs = $12, path = $13,
    read_minutes = $14, locked_body = $15, parent_id = $16,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, parent_id, created_at, updated_at;

-- name: PublishWriting :one
UPDATE writings SET published_at = now(), updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, parent_id, created_at, updated_at;

-- name: UnpublishWriting :one
UPDATE writings SET published_at = NULL, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, parent_id, created_at, updated_at;

-- name: DeleteWriting :exec
DELETE FROM writings WHERE id = $1 AND owner_id = $2;

-- name: GetWritingByID :one
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings WHERE id = $1 AND owner_id = $2;

-- name: GetWritingBySlug :one
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings WHERE owner_id = $1 AND slug = $2;

-- name: GetPublishedWritingByPath :one
-- retriever corpus_read 按树派生 path 读 published writing(DB,不走内存窗口)。
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings WHERE owner_id = $1 AND path = $2 AND published_at IS NOT NULL;

-- name: SearchPublishedWritings :many
-- retriever corpus_search 全量搜 published writing(DB full-text,镜像 wiki/output:
-- 自然语言问句按 OR 命中任一词项,ts_rank 排序),不吃内存窗口。
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings
WHERE owner_id = $1 AND published_at IS NOT NULL
  AND to_tsvector('english', title || ' ' || body_md || ' ' || array_to_string(tags, ' '))
      @@ replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery
ORDER BY ts_rank(
        to_tsvector('english', title || ' ' || body_md || ' ' || array_to_string(tags, ' ')),
        replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery
      ) DESC, published_at DESC
LIMIT $3 OFFSET $4;

-- name: ListWritingsByOwner :many
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings
WHERE owner_id = $1
ORDER BY COALESCE(published_at, created_at) DESC;

-- name: ListPublishedWritingsByOwner :many
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings
WHERE owner_id = $1 AND published_at IS NOT NULL
ORDER BY published_at DESC;

-- name: ListPublishedWritingsByOwnerPage :many
-- 分页 infinite scroll：cursor = 上一页最末 writing.published_at (RFC3339)，
-- 第一页 cursor 传 NULL 拿最新 N 条。返 LIMIT+1 让 caller 判断 has_more。
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings
WHERE owner_id = $1
  AND published_at IS NOT NULL
  AND ($2::timestamptz IS NULL OR published_at < $2::timestamptz)
ORDER BY published_at DESC
LIMIT $3;

-- name: SetWritingObsidianMeta :exec
-- Obsidian import 走完 SaveWriting 之后调用：标记这行 writing 是从 vault
-- 来的，顺便记 imported_at = now()。re-import 时根据 updated_at vs imported_at
-- 决定 skip / overwrite（owner 在 web 改过了 updated_at 会跳过 imported_at）。
UPDATE writings
SET obsidian_source_path = $3,
    obsidian_imported_at = now(),
    updated_at = now()
WHERE id = $1 AND owner_id = $2;

-- name: GetWritingByObsidianSourcePath :one
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, parent_id, created_at, updated_at
FROM writings WHERE owner_id = $1 AND obsidian_source_path = $2;

-- name: ListPublishedWritingSlugAndTitle :many
-- /writings 渲染 [[crosslink]] 时用：拉 owner 所有 published writing 的
-- slug + title 当 resolution index，不带 body_md（避免 N+1 那种全 body 重
-- 传开销）。
SELECT slug, title
FROM writings
WHERE owner_id = $1 AND published_at IS NOT NULL
ORDER BY slug ASC;
