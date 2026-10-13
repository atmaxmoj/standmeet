-- 2026-10-13-retention-bundles.sql —— ephemeral retention (docs/design/job-loop-retention.md).
--
-- retention_bundles is the one clock: an assessment or a microsite is ephemeral iff it has a
-- bundle_id. Deleting the bundle row (a commit, or `retention: forever`) makes every member forever
-- through ON DELETE SET NULL. Everything that exists today has no bundle: it stays forever.

CREATE TABLE IF NOT EXISTS retention_bundles (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    last_touched_at timestamptz NOT NULL DEFAULT now(),
    keep            boolean     NOT NULL DEFAULT false,
    cleared_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retention_bundles_due_idx
    ON retention_bundles (last_touched_at) WHERE cleared_at IS NULL AND NOT keep;

ALTER TABLE job_seen
    ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES retention_bundles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
CREATE INDEX IF NOT EXISTS job_seen_bundle_idx ON job_seen (bundle_id) WHERE bundle_id IS NOT NULL;

ALTER TABLE microsites
    ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES retention_bundles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS expired_at timestamptz;
CREATE INDEX IF NOT EXISTS microsites_bundle_idx ON microsites (bundle_id) WHERE bundle_id IS NOT NULL;

ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS revoked_reason text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS job_assessment_trash (
    job_seen_id uuid        PRIMARY KEY REFERENCES job_seen(id) ON DELETE CASCADE,
    owner_id    uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    annotations jsonb       NOT NULL,
    cleared_at  timestamptz NOT NULL DEFAULT now()
);
