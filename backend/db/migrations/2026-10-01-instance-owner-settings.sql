-- 2026-10-01-instance-owner-settings.sql — the instance's own settings move out of the deployment.
-- Reentrant: safe to run on a database that already has them.
--
-- The owner's rule (2026-10-01): a deployment file carries wiring and secrets the platform
-- generates, never the owner's settings. These were env vars (TURNSTILE_SITE_KEY / TURNSTILE_SECRET,
-- EGRESS_ALLOW_HOSTS + SUPPLIER_EGRESS_ALLOW, MARKETPLACE_GITHUB_BASE_URL); changing one meant
-- editing a compose file and redeploying. They are set on /admin/system now and take effect at once.
-- events: none (owner configuration)
ALTER TABLE instance_settings
    -- internal_hosts —— host names the instance may reach although they resolve to an internal
    -- address (an owner's own CalDAV / mail server / model on the LAN). Every outbound guard honours
    -- it, the BYOAI endpoint check included — the same reach the two env lists gave.
    ADD COLUMN IF NOT EXISTS internal_hosts      jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- captcha_site_key / captcha_secret_enc —— Cloudflare Turnstile. The check is on only when both
    -- are set. The secret is sealed (cryptobox, AAD "instance-captcha") and never returned.
    ADD COLUMN IF NOT EXISTS captcha_site_key    text  NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS captcha_secret_enc  bytea,
    -- skill_catalogue_url —— the GitHub contents API base the skill marketplace reads; '' = the
    -- public anthropics/skills.
    ADD COLUMN IF NOT EXISTS skill_catalogue_url text  NOT NULL DEFAULT '',
    -- legacy_env_imported —— the backend imports an upgraded instance's old env vars into these
    -- columns once, at the first boot on this schema, and only into fields still empty. After that
    -- the owner's own edits win: a field cleared in the UI is not refilled from the env.
    ADD COLUMN IF NOT EXISTS legacy_env_imported boolean NOT NULL DEFAULT false;
