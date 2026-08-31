-- name: CreateCustomPage :one
INSERT INTO custom_pages (owner_id, slug, title)
VALUES ($1, $2, $3)
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, created_at, updated_at;

-- name: GetCustomPageBySlug :one
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       allow_byoai, created_at, updated_at
FROM custom_pages
WHERE owner_id = $1 AND slug = $2 AND status != 'deleted';

-- name: GetCustomPageByID :one
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       allow_byoai, created_at, updated_at
FROM custom_pages
WHERE id = $1 AND status != 'deleted';

-- name: ListCustomPagesByOwner :many
-- 带上 allow_byoai，以及**哪些码开这一页**（绑定的另一头）。
-- 码→页是至多一个；页→码没有这个限制，所以这里是一个数组而不是一个值。
-- 空数组 = 没有码指向它，它只能被匿名打开。
SELECT cp.id, cp.owner_id, cp.slug, cp.title, cp.status,
       cp.live_build_id, cp.staging_build_id, cp.previous_live_build_id,
       cp.allow_byoai, cp.created_at, cp.updated_at,
       COALESCE(
           ARRAY(
               SELECT ac.code::text FROM access_codes ac
               WHERE ac.custom_page_id = cp.id AND ac.status = 'active'
               ORDER BY ac.created_at
           ),
           ARRAY[]::text[]
       )::text[] AS bound_codes
FROM custom_pages cp
WHERE cp.owner_id = $1 AND cp.status != 'deleted'
ORDER BY cp.created_at DESC;

-- name: SetCustomPageByoai :one
-- 这一页在**没有人出示 grant 时**给不给读者用自己的 key。来了 code 就作废（I-4）。
UPDATE custom_pages
SET allow_byoai = $3, updated_at = now()
WHERE owner_id = $1 AND slug = $2 AND status != 'deleted'
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, created_at, updated_at;

-- name: SetCustomPageLive :one
-- 把当前 live_build_id 落到 previous_live_build_id（支持 rollback）再设新 live。
UPDATE custom_pages
SET previous_live_build_id = live_build_id,
    live_build_id          = $2,
    updated_at             = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, created_at, updated_at;

-- name: SetCustomPageStaging :one
UPDATE custom_pages
SET staging_build_id = $2, updated_at = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, created_at, updated_at;

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
          allow_byoai, created_at, updated_at;

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

-- name: GetLatestBuiltCustomPageBuild :one
-- 预览要看的那一次：这一页**最近一次构建成功的**。
--
-- 不用 GetLatestCustomPageBuild：那一条不筛状态，pending / building / failed 都可能拿到，
-- 而那些没有产物 —— owner 会看见一片空白，还以为是自己写的页有问题。
-- 也不看 staging_build_id：那要 agent 记得多调一次 promote_to_staging，
-- 忘了就什么都看不见，而 owner 要的是"看到它刚做了什么"。
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM custom_page_builds
WHERE page_id = $1 AND status = 'built'
ORDER BY created_at DESC
LIMIT 1;
