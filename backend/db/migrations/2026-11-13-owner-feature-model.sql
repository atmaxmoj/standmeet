-- 2026-11-13-owner-feature-model.sql — a MODEL can be pinned per FEATURE, with an optional ROLE
-- scope, overriding the resolved provider's own model while reusing its key — so one Anthropic key
-- serves haiku for visitor chat and sonnet for the screen-assistant (interview cue) feature, with no
-- duplicate provider.
--
-- The model-resolution cascade, each layer overriding the one above, all reusing the provider's key:
--   provider.model (global default)
--     → feature global   (owner_feature_models, role_id = '')
--       → role×feature   (owner_feature_models, role_id = the role)
--         → code.model   (access_codes.model, already exists)
--
-- Why a feature layer over the existing access_codes.model: a per-code override has to be set on each
-- code and a newly issued code silently falls back to the provider's model. A feature override is the
-- durable guarantee — every call of that feature (e.g. the interview cue), on any code or none,
-- resolves to the pinned model; a role may still override a given feature on top of that global.
--
-- role_id —— '' = the feature's global pin; a role id = that role's override of this feature. One
-- table, role_id in the PK, so a single `role_id IN (<role>,'') ORDER BY role_id DESC LIMIT 1` reads
-- the cascade (role override before the global).
-- feature —— the inference feature name (e.g. 'screen_assistant' for the interview cue), matching the
-- Feature string the usage ledger already records.
--
-- Upgrade path: CREATE TABLE IF NOT EXISTS, no backfill — an owner with no row keeps today's
-- behaviour. Re-runnable; a no-op on a fresh install (schema.sql has it).
CREATE TABLE IF NOT EXISTS owner_feature_models (
    owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    role_id  text NOT NULL DEFAULT '',
    feature  text NOT NULL,
    model    text NOT NULL,
    PRIMARY KEY (owner_id, role_id, feature)
);
