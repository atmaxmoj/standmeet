-- 2026-09-04 · One more job-source kind: the generic `rss` adapter.
--
-- job_sources.kind is an enum-by-CHECK, so register_source rejects a kind the constraint doesn't
-- list — a new fetch adapter is dead until the constraint admits its kind. `rss` is the generic
-- RSS-feed adapter (config {feed_url}); it covers the long tail of niche boards with one adapter,
-- and the default-source seeder relies on it.
--
-- Idempotent: drop the kind CHECK (auto-named job_sources_kind_check on fresh installs from
-- schema.sql, or the named job_sources_kind_allowed from a prior run) and re-add it with the full
-- list. Every existing row already carries a listed kind, so the re-add never fails. NEW migration;
-- it does not touch any earlier one.

ALTER TABLE job_sources DROP CONSTRAINT IF EXISTS job_sources_kind_check;
ALTER TABLE job_sources DROP CONSTRAINT IF EXISTS job_sources_kind_allowed;
ALTER TABLE job_sources ADD CONSTRAINT job_sources_kind_allowed CHECK (kind IN (
  'greenhouse','lever','ashby','remoteok','wwr','hn_hiring',
  'smartrecruiters','workable','jba','workday','bamboohr',
  'jobicy','remotive','himalayas','working_nomads','recruitee',
  'jobposting_jsonld','rss'));
