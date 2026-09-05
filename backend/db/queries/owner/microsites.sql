-- name: CreateMicrosite :one
INSERT INTO microsites (owner_id, slug, title)
VALUES ($1, $2, $3)
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, store_writable, created_at, updated_at;

-- name: GetMicrositeBySlug :one
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       allow_byoai, store_writable, created_at, updated_at
FROM microsites
WHERE owner_id = $1 AND slug = $2 AND status != 'deleted';

-- name: GetMicrositeByID :one
SELECT id, owner_id, slug, title, status,
       live_build_id, staging_build_id, previous_live_build_id,
       allow_byoai, store_writable, created_at, updated_at
FROM microsites
WHERE id = $1 AND status != 'deleted';

-- name: ListMicrositesByOwner :many
-- Includes allow_byoai, plus **which codes open this page** (the other end of the binding).
-- Code->page is at most one; page->code has no such limit, so this is an array, not a single value.
-- Empty array = no code points at it, it can only be opened anonymously.
SELECT cp.id, cp.owner_id, cp.slug, cp.title, cp.status,
       cp.live_build_id, cp.staging_build_id, cp.previous_live_build_id,
       cp.allow_byoai, cp.store_writable, cp.created_at, cp.updated_at,
       COALESCE(
           ARRAY(
               SELECT ac.code::text FROM access_codes ac
               WHERE ac.microsite_id = cp.id AND ac.status = 'active'
               ORDER BY ac.created_at
           ),
           ARRAY[]::text[]
       )::text[] AS bound_codes
FROM microsites cp
WHERE cp.owner_id = $1 AND cp.status != 'deleted'
ORDER BY cp.created_at DESC;

-- name: SetMicrositeByoai :one
-- Whether this page lets a reader use their own key **when no one presents a grant**. Void once a
-- code arrives (I-4).
UPDATE microsites
SET allow_byoai = $3, updated_at = now()
WHERE owner_id = $1 AND slug = $2 AND status != 'deleted'
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, store_writable, created_at, updated_at;

-- name: SetMicrositeLive :one
-- Move the current live_build_id into previous_live_build_id (to support rollback), then set the new live.
UPDATE microsites
SET previous_live_build_id = live_build_id,
    live_build_id          = $2,
    updated_at             = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, store_writable, created_at, updated_at;

-- name: SetMicrositeStaging :one
UPDATE microsites
SET staging_build_id = $2, updated_at = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, store_writable, created_at, updated_at;

-- name: RollbackMicrositeLive :one
-- Promote previous_live_build_id back to live, clearing previous. When previous was already NULL
-- -> live is set to NULL too (the page goes offline, the next visitor gets a 404).
UPDATE microsites
SET live_build_id          = previous_live_build_id,
    previous_live_build_id = NULL,
    updated_at             = now()
WHERE id = $1
RETURNING id, owner_id, slug, title, status,
          live_build_id, staging_build_id, previous_live_build_id,
          allow_byoai, store_writable, created_at, updated_at;

-- name: SoftDeleteMicrosite :exec
UPDATE microsites
SET status = 'deleted', updated_at = now()
WHERE id = $1;

-- name: CreateMicrositeBuild :one
INSERT INTO microsite_builds (page_id, source_files)
VALUES ($1, $2)
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: ClaimPendingBuild :one
-- Concurrency-safe via FOR UPDATE SKIP LOCKED; the usecase calls SetBuilding immediately after claiming.
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM microsite_builds
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- name: GetMicrositeBuild :one
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM microsite_builds
WHERE id = $1;

-- name: GetLatestMicrositeBuild :one
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM microsite_builds
WHERE page_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: SetMicrositeBuildBuilding :one
UPDATE microsite_builds
SET status = 'building'
WHERE id = $1
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: SetMicrositeBuildBuilt :one
UPDATE microsite_builds
SET status      = 'built',
    output_path = $2,
    built_at    = now()
WHERE id = $1
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: SetMicrositeBuildFailed :one
UPDATE microsite_builds
SET status        = 'failed',
    error_message = $2,
    built_at      = now()
WHERE id = $1
RETURNING id, page_id, status, source_files, output_path,
          error_message, created_at, built_at;

-- name: GetLatestBuiltMicrositeBuild :one
-- The one the preview should show: this page's **most recent successful build**.
--
-- Not GetLatestMicrositeBuild: that one doesn't filter status, so pending / building / failed could
-- come back, and those have no output -- the owner would see a blank and think the page they wrote
-- is broken.
-- Nor staging_build_id: that requires the agent to remember an extra promote_to_staging call, and
-- forgetting it shows nothing -- but the owner wants to "see what it just did".
SELECT id, page_id, status, source_files, output_path,
       error_message, created_at, built_at
FROM microsite_builds
WHERE page_id = $1 AND status = 'built'
ORDER BY created_at DESC
LIMIT 1;

-- name: SetMicrositeStoreWritable :exec
-- Owner toggles whether this page's store accepts visitor writes. Owner-scoped by (owner_id, slug).
UPDATE microsites SET store_writable = $3, updated_at = now()
WHERE owner_id = $1 AND slug = $2 AND status != 'deleted';
