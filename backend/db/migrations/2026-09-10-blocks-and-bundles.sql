-- 2026-09-10-blocks-and-bundles.sql — the owner installs blocks and assembles them
-- into bundles; a code is bound to a bundle.
--
-- `docs/design/plugin/frontend.md` §3: "what can this code do" stops being
-- `global ∧ role ∧ ¬code-deny` evaluated over three screens and becomes a list the
-- owner reads off one. Three tables carry that, and nothing else changes shape:
-- the per-code denial editors stay where they are until a code actually carries a
-- bundle, so an instance that never assembles one behaves exactly as before.

-- installed_blocks — a block the owner pasted in, as data.
--
-- The manifest is stored verbatim, not exploded into columns. It is the block's own
-- declaration and the loader already knows how to read it; a second, column-shaped
-- copy would be a place for the two to disagree — which is how the booking policy
-- ended up saying 18:00 on one side and 17:00 on the other.
CREATE TABLE IF NOT EXISTS installed_blocks (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    -- block_id — the id the manifest declares. Unique per owner: installing the same
    -- block twice is an update, never a second copy that shadows the first.
    block_id    text        NOT NULL,
    title       text        NOT NULL DEFAULT '',
    manifest    text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, block_id)
);

-- bundles — a named set of blocks. The thing a code points at.
CREATE TABLE IF NOT EXISTS bundles (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_id, name)
);

-- bundle_blocks — membership, by block id rather than by a foreign key.
--
-- A member may be a built-in (which has no row anywhere — it ships in the image) or
-- an installed one. A foreign key would only be able to express the second, so the
-- membership of a bundle would silently depend on where the block came from.
CREATE TABLE IF NOT EXISTS bundle_blocks (
    bundle_id   uuid        NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    block_id    text        NOT NULL,
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bundle_id, block_id)
);

-- block_failures — the owner's half of "failure has three faces".
--
-- Persistent by construction: a toast that appears if the owner happens to be looking
-- is not a diagnosis. One row per (bundle, block), overwritten on each new failure, so
-- the panel reads the CURRENT state rather than a growing log the owner must scroll.
-- `stderr` is what the child said before it died — the one thing a generic "failed to
-- bind" message can never carry.
-- Keyed by (owner, block), not (bundle, block): a failure is a property of the BLOCK.
-- One block can sit in several bundles, and keying by bundle would write the same fact
-- several times and then let the copies go stale independently. A bundle's health is
-- "which of my members failed", which is one join away.
CREATE TABLE IF NOT EXISTS block_failures (
    owner_id    uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    block_id    text        NOT NULL,
    title       text        NOT NULL DEFAULT '',
    stderr      text        NOT NULL DEFAULT '',
    failed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, block_id)
);

-- access_codes.bundle_id — which bundle this code carries.
--
-- NULL keeps today's behaviour exactly (role ACL + per-code denials), which is what
-- lets the two models stand side by side while the panels are rewritten. SET NULL on
-- delete: deleting a bundle must not delete the codes that were handed out under it —
-- the visitor holding one falls back to the role, and the owner can see that happened.
ALTER TABLE access_codes
    ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES bundles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bundle_blocks_block ON bundle_blocks (block_id);
CREATE INDEX IF NOT EXISTS idx_access_codes_bundle ON access_codes (bundle_id);
