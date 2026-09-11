-- monitoring_enabled —— the owner's traffic-collection master switch (monitor.md §8). true (the
-- default) keeps the always-on behaviour every shipped instance has today; flipping it off stops
-- the recorder at the gate (cmd/server monitor_wireup collectionEnabled → monitor shouldRecord).
--
-- Additive + idempotent + safe default, so deploying the new version onto a running instance (an
-- existing owners row) never blows up on the NOT NULL: old rows get true. Upgrade path proven by
-- upgrade-monitoring-enabled-column.spec.ts.
ALTER TABLE owners ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT true;
