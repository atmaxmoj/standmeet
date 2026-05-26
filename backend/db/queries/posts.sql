-- name: CreatePost :one
INSERT INTO posts (
    owner_id, slug, title, excerpt, body_md,
    cover_headline, cover_sub, cover_hue, cover_image_asset_id,
    tags, visibility, cross_refs, path, read_minutes, locked_body,
    published_at
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13, $14, $15,
    $16
)
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, created_at, updated_at;

-- name: UpdatePost :one
UPDATE posts SET
    title = $3, excerpt = $4, body_md = $5,
    cover_headline = $6, cover_sub = $7, cover_hue = $8, cover_image_asset_id = $9,
    tags = $10, visibility = $11, cross_refs = $12, path = $13,
    read_minutes = $14, locked_body = $15,
    updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, created_at, updated_at;

-- name: PublishPost :one
UPDATE posts SET published_at = now(), updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, created_at, updated_at;

-- name: UnpublishPost :one
UPDATE posts SET published_at = NULL, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING id, owner_id, slug, title, excerpt, body_md,
          cover_headline, cover_sub, cover_hue, cover_image_asset_id,
          tags, visibility, cross_refs, path, read_minutes, locked_body,
          obsidian_source_path, obsidian_imported_at,
          published_at, created_at, updated_at;

-- name: DeletePost :exec
DELETE FROM posts WHERE id = $1 AND owner_id = $2;

-- name: GetPostByID :one
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, created_at, updated_at
FROM posts WHERE id = $1 AND owner_id = $2;

-- name: GetPostBySlug :one
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, created_at, updated_at
FROM posts WHERE owner_id = $1 AND slug = $2;

-- name: ListPostsByOwner :many
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, created_at, updated_at
FROM posts
WHERE owner_id = $1
ORDER BY COALESCE(published_at, created_at) DESC;

-- name: ListPublishedPostsByOwner :many
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, created_at, updated_at
FROM posts
WHERE owner_id = $1 AND published_at IS NOT NULL
ORDER BY published_at DESC;

-- name: ListPublishedPostsByOwnerPage :many
-- 分页 infinite scroll：cursor = 上一页最末 post.published_at (RFC3339)，
-- 第一页 cursor 传 NULL 拿最新 N 条。返 LIMIT+1 让 caller 判断 has_more。
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, created_at, updated_at
FROM posts
WHERE owner_id = $1
  AND published_at IS NOT NULL
  AND ($2::timestamptz IS NULL OR published_at < $2::timestamptz)
ORDER BY published_at DESC
LIMIT $3;

-- name: SetPostObsidianMeta :exec
-- Obsidian import 走完 SavePost 之后调用：标记这行 post 是从 vault 来的，
-- 顺便记 imported_at = now()。re-import 时根据 updated_at vs imported_at 决
-- 定 skip / overwrite（owner 在 web 改过了 updated_at 会跳过 imported_at）。
UPDATE posts
SET obsidian_source_path = $3,
    obsidian_imported_at = now(),
    updated_at = now()
WHERE id = $1 AND owner_id = $2;

-- name: GetPostByObsidianSourcePath :one
SELECT id, owner_id, slug, title, excerpt, body_md,
       cover_headline, cover_sub, cover_hue, cover_image_asset_id,
       tags, visibility, cross_refs, path, read_minutes, locked_body,
       obsidian_source_path, obsidian_imported_at,
       published_at, created_at, updated_at
FROM posts WHERE owner_id = $1 AND obsidian_source_path = $2;

-- name: ListPublishedSlugAndTitle :many
-- /blog 渲染 [[crosslink]] 时用：拉 owner 所有 published post 的 slug + title
-- 当 resolution index，不带 body_md（避免 N+1 那种全 body 重传开销）。
SELECT slug, title
FROM posts
WHERE owner_id = $1 AND published_at IS NOT NULL
ORDER BY slug ASC;
