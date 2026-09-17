-- 2026-09-17-bundle-includes.sql — bundles nest by reference (access-control.md
-- "Bundles nest, and nesting yields a bundle").
--
-- A bundle may include other bundles; a code bound to the outer bundle resolves to the
-- recursive, deduped union of every reached bundle's blocks. Inclusion is by reference for
-- the same reason a code's binding is: editing an included bundle moves every bundle (and
-- so every code) that reaches it, with no copy to keep in sync.
--
-- Reentrant (IF NOT EXISTS): an old volume gains the table, a volume already in shape is a
-- no-op. The primary key forbids a duplicate edge; the CHECK forbids the one-hop self-cycle
-- (a longer cycle is refused at write, in Go, by a reachability walk).
CREATE TABLE IF NOT EXISTS bundle_includes (
    bundle_id   uuid        NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    includes_id uuid        NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    position    int         NOT NULL DEFAULT 0,
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bundle_id, includes_id),
    CHECK (bundle_id <> includes_id)
);

-- "which bundles include THIS one" — read when resolving members and when checking a
-- proposed edge for a cycle.
CREATE INDEX IF NOT EXISTS idx_bundle_includes_includes ON bundle_includes (includes_id);
