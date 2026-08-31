-- 2026-08-16 · corpus_notes.cover_hue —— give "the owner never picked a hue" a value (F-L-38).
--
-- Why this file exists at all: schema.sql is applied by postgres ONLY on a fresh volume, so a
-- long-lived instance keeps the shape it was born with. Declaring the new default in schema.sql
-- fixes tomorrow's instances and nothing else; this file is what the running one gets.
--
-- Safe to run again, and it must stay that way: the backend applies every unrecorded migration at
-- boot (pgstore.Migrate), so this file runs on any instance whose ledger has not yet seen it. The
-- backfill clears a state the product cannot produce -- cover art exists for writings only, and the
-- WHERE below excludes writings -- so a second run finds no rows. Do not widen it to a genre the
-- owner can actually set a hue on: that would turn a re-deploy into data loss.
--
-- Two statements, and they are different in kind:
--
--   1. the DEFAULT. From now on a note that was never given a hue stores ''. Before this, every
--      note in the corpus reported 'amber' — a colour nobody chose — and the panel's
--      "— default —" option had nothing to store, so it could not be saved back.
--
--   2. the backfill, deliberately narrow. It touches only rows where the hue is unobservable:
--      not a writing (writings normalise their hue on create — amber there is a real choice),
--      no cover image, no cover headline. Such a note renders no hero at all, so the stored hue
--      reaches no screen; the only place it showed up was the edit form, asserting a choice the
--      owner never made. Rows with an actual hero keep whatever they carry — this migration must
--      not repaint anybody's page.
--
-- Non-destructive by construction: no column is dropped, no row loses anything that renders.

ALTER TABLE corpus_notes ALTER COLUMN cover_hue SET DEFAULT '';

UPDATE corpus_notes
   SET cover_hue = ''
 WHERE genre <> 'writing'
   AND cover_hue <> ''
   AND cover_headline = ''
   AND cover_image_asset_id IS NULL;
