-- posts.sql — every query that touches the posts table (check-posts-one-reader keeps it here).
--
-- A reader is (owner_view, role_id): the owner sees every post; anyone else sees what
-- post_visible(visibility, visible_role_ids, role_id) admits — the one rule, in schema.sql.

-- name: CreatePost :one
INSERT INTO posts (owner_id, body, visibility, visible_role_ids)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdatePost :one
UPDATE posts SET body = $3, visibility = $4, visible_role_ids = $5, updated_at = now()
WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: GetPost :one
SELECT * FROM posts
WHERE owner_id = sqlc.arg(owner_id) AND id = sqlc.arg(id) AND deleted_at IS NULL
  AND (sqlc.arg(owner_view)::bool OR post_visible(visibility, visible_role_ids, sqlc.arg(role_id)::text));

-- name: ListPosts :many
SELECT * FROM posts
WHERE owner_id = sqlc.arg(owner_id) AND deleted_at IS NULL
  AND (sqlc.arg(owner_view)::bool OR post_visible(visibility, visible_role_ids, sqlc.arg(role_id)::text))
  AND (sqlc.arg(visibility)::text = '' OR visibility = sqlc.arg(visibility)::text)
  AND (sqlc.arg(q)::text = '' OR body ILIKE '%' || sqlc.arg(q)::text || '%'
       OR to_tsvector('simple', body) @@ websearch_to_tsquery('simple', sqlc.arg(q)::text))
  AND (sqlc.narg(after_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(after_at)::timestamptz, sqlc.narg(after_id)::uuid))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(lim);

-- name: CountPosts :one
SELECT count(*)::int FROM posts
WHERE owner_id = sqlc.arg(owner_id) AND deleted_at IS NULL
  AND (sqlc.arg(owner_view)::bool OR post_visible(visibility, visible_role_ids, sqlc.arg(role_id)::text))
  AND (sqlc.arg(visibility)::text = '' OR visibility = sqlc.arg(visibility)::text)
  AND (sqlc.arg(q)::text = '' OR body ILIKE '%' || sqlc.arg(q)::text || '%'
       OR to_tsvector('simple', body) @@ websearch_to_tsquery('simple', sqlc.arg(q)::text));

-- name: TrashPost :one
UPDATE posts SET deleted_at = now()
WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
RETURNING *;

-- name: RestorePost :one
UPDATE posts SET deleted_at = NULL
WHERE owner_id = $1 AND id = $2 AND deleted_at IS NOT NULL
RETURNING *;

-- name: ListTrashedPosts :many
SELECT * FROM posts
WHERE owner_id = $1 AND deleted_at IS NOT NULL
ORDER BY deleted_at DESC, id DESC;

-- name: PurgePosts :many
DELETE FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < $1
RETURNING id;
