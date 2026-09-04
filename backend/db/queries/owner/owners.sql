-- name: CreateOwner :one
INSERT INTO owners (email, password_hash, handle, full_name, public_url)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOwnerByEmail :one
SELECT * FROM owners WHERE email = $1;

-- name: GetOwnerByID :one
SELECT * FROM owners WHERE id = $1;

-- name: GetOwnerByHandle :one
SELECT * FROM owners WHERE handle = $1;

-- name: CountOwners :one
SELECT COUNT(*) FROM owners;

-- name: GetFirstOwnerHandle :one
-- v1 single-owner instance: returns the handle of the earliest-created owner; the app root path uses it to redirect.
SELECT handle FROM owners ORDER BY created_at ASC LIMIT 1;

-- name: UpdateOwnerBYOAI :one
UPDATE owners
SET byoai_enabled = $2,
    byoai_providers = $3,
    byoai_public_blurb = $4
WHERE id = $1
RETURNING *;

-- UpdateOwnerAIProvider was deleted with the four ai_* columns: an owner holds a *book* of
-- providers now (owner_providers.sql), one of them marked default. Writing "the owner's provider"
-- is writing one row of that book.

-- name: UpdateOwnerPublicURL :one
UPDATE owners
SET public_url = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerFullName :one
UPDATE owners
SET full_name = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerEmail :one
UPDATE owners
SET email = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerPasswordHash :one
UPDATE owners
SET password_hash = $2
WHERE id = $1
RETURNING *;

-- name: SetOwnerRecoveryHash :exec
-- #100: store/rotate the hash of the recovery phrase (the plaintext goes only into the email).
UPDATE owners SET recovery_hash = $2 WHERE id = $1;

-- name: ClearOwnerRecoveryHash :exec
-- #100: invalidate after a successful recovery (single use).
UPDATE owners SET recovery_hash = '' WHERE id = $1;

-- name: UpdateOwnerProfileTimezone :one
UPDATE owners
SET profile_timezone = $2
WHERE id = $1
RETURNING *;

-- name: GetOwnerPasswordHash :one
SELECT password_hash FROM owners WHERE id = $1;

-- name: SetPasswordResetToken :exec
-- Emergency reset token: write the hash + current time. Each owner may have only one reset token at
-- a time; the old one is overwritten by the new ("re-run the command" is also valid UX).
UPDATE owners SET password_reset_hash = $2, password_reset_at = NOW() WHERE id = $1;

-- name: GetFirstOwnerResetToken :one
-- single-owner self-host: the reset flow recovers via the sole owner. Returns owner_id + hash + at
-- for the usecase to compare + check TTL. Empty table -> ErrNoRows, the caller maps it to unauthorized.
SELECT id, password_reset_hash, password_reset_at FROM owners
ORDER BY created_at ASC LIMIT 1;

-- name: ClearPasswordResetToken :exec
-- Clear after a successful reset, making the token single-use.
UPDATE owners SET password_reset_hash = ''::bytea, password_reset_at = NULL WHERE id = $1;

-- name: GetOwnerCSS :one
-- The owner's custom CSS (the safe, already sanitized+scoped version).
SELECT custom_css FROM owners WHERE id = $1;

-- name: SetOwnerCSS :exec
-- Store the owner's CSS (what the caller passes in should already be the sanitized+scoped safe version).
UPDATE owners SET custom_css = $2 WHERE id = $1;

-- name: RecordVaultImport :execrows
-- UX-62: record the "last vault import" -- the import is the operation that defines this product's
-- ground truth, and before this "did it happen" had no landing spot in the DB, so that on-screen
-- count vanished on refresh.
-- :execrows rather than :exec -- hitting 0 rows must be reportable ([[write-with-no-receipt]]).
UPDATE owners
SET last_vault_import_at = now(),
    last_vault_import_new = $2,
    last_vault_import_updated = $3,
    last_vault_import_skipped = $4,
    last_vault_import_deleted = $5
WHERE id = $1;

-- name: SetOwnerPendingEmail :one
-- An email change pending confirmation. The identity **does not move** -- it only switches when the
-- link in the email is clicked.
-- A second request simply overwrites: if both worked, the owner thinks they changed to the latter,
-- while one click on an old tab would send the identity to the former.
UPDATE owners
SET pending_email = $2, pending_email_token_hash = $3, pending_email_expires_at = $4
WHERE id = $1
RETURNING *;

-- name: ClearOwnerPendingEmail :one
-- The owner changes their mind. :one + RETURNING is what tells us whether a row was actually
-- cleared (:exec throws the row count away).
UPDATE owners
SET pending_email = NULL, pending_email_token_hash = '', pending_email_expires_at = NULL
WHERE id = $1
RETURNING *;

-- name: ConfirmOwnerPendingEmail :one
-- Single-use + not-expired, all decided in this one statement: 0 rows = wrong token / expired /
-- already used. After switching, clear all three columns -- a replayable confirmation link is like
-- hanging the identity on an old email.
UPDATE owners
SET email = pending_email,
    pending_email = NULL,
    pending_email_token_hash = '',
    pending_email_expires_at = NULL
WHERE pending_email_token_hash = $1
  AND pending_email_token_hash <> ''
  AND pending_email IS NOT NULL
  AND pending_email_expires_at > now()
RETURNING *;

-- name: GetOwnerByPendingToken :one
-- Only to distinguish "expired" from "invalid outright" -- neither switches the identity, but what
-- we tell the owner differs, and what they should do next depends on that distinction.
SELECT * FROM owners
WHERE pending_email_token_hash = $1 AND pending_email_token_hash <> '';
