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

-- The owner's instance settings (internal hosts / skill catalogue). The captcha pair has its own
-- write: its secret is sealed and kept unless the owner replaces or clears it.
-- name: SetInstanceOwnerSettings :exec
UPDATE instance_settings
SET internal_hosts = $1::jsonb,
    skill_catalogue_url = $2
WHERE id = 1;

-- name: SetCaptchaSiteKey :exec
UPDATE instance_settings
SET captcha_site_key = $1
WHERE id = 1;

-- name: SetCaptchaSecret :exec
UPDATE instance_settings
SET captcha_secret_enc = $1
WHERE id = 1;

-- name: MarkLegacyEnvImported :exec
UPDATE instance_settings
SET legacy_env_imported = true
WHERE id = 1;
