-- name: CreateCustomPage :one
INSERT INTO custom_pages (owner_id, slug, title)
VALUES ($1, $2, $3)
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          created_at, updated_at;

-- name: GetCustomPageBySlug :one
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       created_at, updated_at
FROM custom_pages
WHERE owner_id = $1 AND slug = $2 AND status != 'deleted';

-- name: GetCustomPageByID :one
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       created_at, updated_at
FROM custom_pages
WHERE id = $1 AND status != 'deleted';

-- name: ListCustomPagesByOwner :many
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       created_at, updated_at
FROM custom_pages
WHERE owner_id = $1 AND status != 'deleted'
ORDER BY created_at DESC;

-- name: SetCustomPageLive :one
-- 把当前 live_build_id 落到 previous_live_build_id（支持 rollback）再设新 live。
UPDATE custom_pages
SET previous_live_build_id = live_build_id,
    live_build_id          = $2,
    updated_at             = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          created_at, updated_at;

-- name: SetCustomPageStaging :one
UPDATE custom_pages
SET staging_build_id = $2, updated_at = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          created_at, updated_at;

-- name: RollbackCustomPageLive :one
-- previous_live_build_id 提回 live，previous 清空。previous 本来就是 NULL
-- 时 → live 也被设 NULL（页面下线，下次访客访问 404）。
UPDATE custom_pages
SET live_build_id          = previous_live_build_id,
    previous_live_build_id = NULL,
    updated_at             = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          created_at, updated_at;

-- name: SoftDeleteCustomPage :exec
UPDATE custom_pages
SET status = 'deleted', updated_at = now()
WHERE id = $1;

-- name: CreateCustomPageBuild :one
INSERT INTO custom_page_builds (page_id, source_files)
VALUES ($1, $2)
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: ClaimPendingBuild :one
-- 用 FOR UPDATE SKIP LOCKED 让并发安全；usecase 拿到后立刻 SetBuilding。
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM custom_page_builds
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- name: GetCustomPageBuild :one
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM custom_page_builds
WHERE id = $1;

-- name: GetLatestCustomPageBuild :one
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM custom_page_builds
WHERE page_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: SetCustomPageBuildBuilding :one
UPDATE custom_page_builds
SET status = 'building'
WHERE id = $1
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: SetCustomPageBuildBuilt :one
UPDATE custom_page_builds
SET status      = 'built',
    output_path = $2,
    built_at    = now()
WHERE id = $1
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: SetCustomPageBuildFailed :one
UPDATE custom_page_builds
SET status        = 'failed',
    error_message = $2,
    built_at      = now()
WHERE id = $1
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;
