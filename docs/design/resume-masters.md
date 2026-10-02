# Résumé masters

Status: approved by the owner 2026-09-29 ("that's about right, go ahead and start"). Mockups: https://claude.ai/artifact/UZ8XWUcQrTUaf411izZsGe

## Problem

A résumé draft lives one day (`resume_drafts.expires_at` default `now() + 1 day`, hourly sweep). The
only lasting copy is the `applications` row made at commit. "New draft" copies the owner's newest
*unexpired* draft, so after a quiet day it starts blank. The owner: "it still bugs me quite a bit that the résumé doesn't persist".

## What we build

A **master** (zh UI term: 母版) is a named, persistent résumé: `resume_content` only — no job, no access code,
no expiry. Drafts stay what they are (per job, 24 h), and now start from a master.

- An owner has 0..N masters. At most one is the **default**.
- **Save a draft as a master** (composer, "set as master ▾"):
  - overwrite the master the draft came from (default choice when the draft has one), or
  - save as a new master with a name; optionally make it the default.
  Only `resume_content` is copied. The draft is unchanged and keeps its expiry.
- **New draft** asks "start from": each master (default pre-selected) or blank. The draft records the
  master it came from (`based_on_master_id`, nullable; the master may be deleted later → set NULL).
  This replaces the "copy the newest draft" corner in `CreateManualDraft`.
- **Master editor**: the same Puck composer, in master mode — no SEND, no code picker, a banner saying
  it is not tied to a job; Save writes the master; "new draft from it" opens the new-draft flow on it.
- **Drafts page**: a masters strip on top (card: thumbnail, name, default badge, updated date and
  which draft it came from, actions Edit / New draft from it; plus "+ new master" from blank), drafts list
  below with "based on: <master>" and an "N hours left" expiry chip.
- **Rename / delete / set default** on a master card.
- **Paging**: the masters list and the drafts list both go through the one paging util
  (docs/design/paging.md; keyset cursor, LIMIT+1). Drafts were "leave alone (TTL)" in that ledger —
  the owner overruled it on 2026-09-29 ("get paging done properly too, don't forget"). Update the ledger.

## Where the fact lives

The master lives in the StandMeet database: it is product state the owner edits in the UI. The vault
note `subjectivity/resume.md` still carries a `resume_content` JSON block — a second home. Out of
scope here; flagged to the owner to decide (derive one from the other, or drop the vault JSON).

## Surfaces (facade parity)

Every operation exists on the admin HTTP facade and the owner MCP facade, from one registry
(docs/design/facade-parity.md):
`resume.master_list` (paged), `resume.master_get`, `resume.master_create` (name, resume_content, from
draft_id or blank), `resume.master_update` (name / resume_content / is_default), `resume.master_delete`,
`resume.draft_save_as_master` (draft_id, master_id to overwrite | new name, make_default),
and `resume.draft` / admin `POST /drafts` gain optional `master_id`.

## Tests — written first, each proven RED on the current code

E2E (black box: drive the UI or the MCP the way the owner does; assert visible outcomes):
1. `resume-master-save-from-draft` — in the composer, set as master → new name → the masters strip shows it
   with the draft's summary text; reopening the master editor shows the same content.
2. `resume-master-outlives-drafts` — make a master from a draft, expire all drafts (psql, like
   `resume-draft-ttl`), run the sweep → the master is still listed and opens with its content.
3. `resume-master-new-draft-from-master` — new draft, pick a non-default master → the draft opens with
   that master's content and its row says "based on: <name>"; the master itself is unchanged after the draft
   is edited and saved.
4. `resume-master-overwrite` — a draft based on master A, edit, set as master → overwrite A → A shows the edit.
5. `resume-master-default` — set B as default → the new-draft modal pre-selects B; only one default.
6. `resume-master-editor-no-send` — the master editor has no SEND and no code picker; Save persists.
7. `resume-master-delete` — delete a master that a draft is based on → the draft still opens; its row
   no longer names a master.
8. `resume-master-mcp` — MCP: master_create → master_list (paged) → draft with master_id → the draft's
   content equals the master's; save_as_master round-trips.
9. `resume-master-paging` — create more masters than one page (and more drafts than one page) → the
   pager reaches the last one, counts are right.
10. i18n: labels exist in all 8 locales (the key-parity gate covers it; one zh assertion in spec 1).

Upgrade test (`upgrade-resume-masters.spec.ts`, same pattern as the other `upgrade-*` specs): an
instance at the previous schema with live drafts and applications upgrades → the migration adds
`resume_masters` and `resume_drafts.based_on_master_id`; existing drafts still open and commit; the
masters strip is empty and "+ new master" works.

Release gate: new specs RED on old code → GREEN; REPEAT=5 on the new specs; neighbouring résumé/draft
specs green; make lint rc 0.
