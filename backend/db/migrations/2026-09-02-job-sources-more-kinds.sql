-- 2026-09-02 · Six more job-source kinds: jobicy / remotive / himalayas /
-- working_nomads / recruitee, plus the generic jobposting_jsonld ingester.
--
-- job_sources.kind is an enum-by-CHECK, so register_source rejects a kind the
-- constraint doesn't list — a new fetch adapter is dead until the constraint
-- admits its kind.
--
-- Idempotent: drop the kind CHECK (auto-named job_sources_kind_check on fresh
-- installs from schema.sql, or the named job_sources_kind_allowed from a prior
-- run of this migration) and re-add it with the full list. Every existing row
-- already carries a listed kind, so the re-add never fails. This is a NEW
-- migration; it does not touch any earlier one.

ALTER TABLE job_sources DROP CONSTRAINT IF EXISTS job_sources_kind_check;
ALTER TABLE job_sources DROP CONSTRAINT IF EXISTS job_sources_kind_allowed;
ALTER TABLE job_sources ADD CONSTRAINT job_sources_kind_allowed CHECK (kind IN (
  'greenhouse','lever','ashby','remoteok','wwr','hn_hiring',
  'smartrecruiters','workable','jba','workday','bamboohr',
  'jobicy','remotive','himalayas','working_nomads','recruitee',
  'jobposting_jsonld'));
