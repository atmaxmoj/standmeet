-- name: GetInstanceSettings :one
SELECT * FROM instance_settings WHERE id = 1;

-- Write the current setup_token_hash into instance_settings; called once at startup to make the
-- setup token actually take effect.
-- name: SetSetupTokenHash :exec
UPDATE instance_settings
SET setup_token_hash = $1
WHERE id = 1;

-- Atomic claim: mark claimed + clear the token if and only if is_claimed=false and setup_token_hash
-- matches. Returns the updated row; the caller judges success from it (0 rows affected means the
-- token is wrong or it was already claimed).
-- name: TryClaimInstance :one
UPDATE instance_settings
SET is_claimed = true,
    setup_token_hash = NULL
WHERE id = 1
  AND is_claimed = false
  AND setup_token_hash = $1
RETURNING *;

-- name: SetAllowedDomains :exec
UPDATE instance_settings
SET allowed_domains = $1::jsonb
WHERE id = 1;
