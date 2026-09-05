# Global asset pool (Resources → Assets)

Status: **designed, ready to build** (decided 2026-09-05). Owner's call: assets are
**global**, not holder-owned. An asset referenced by a corpus entry or a microsite
**cannot be deleted** — you delete the referrer first — and a blocked delete
**names who references it**.

> This is a rework of the corpus content transactions (note create/update/delete +
> asset serve + storage keys) — the most data-integrity-sensitive path in the
> product. The owner has stressed it is **very error-prone and needs a lot of
> tests**. It is therefore built as a **focused, test-first** effort against the
> matrix at the bottom, not squeezed in beside other work. The tree stays on the
> holder-owned model until this lands whole.

## The change

Today assets are **holder-owned**: an `assets` row exists only as part of a
corpus note (`holder_id` = note id), created and deleted in the same transaction,
storage key `<holder_id>/<asset_id>`. There is no standalone asset, no upload
without a holder, and delete is implicit (the holder's delete drops its assets).

The new model is a **pool + references**:

- **Pool.** An asset belongs to an **owner**, not a holder. The owner uploads
  into the pool directly (panel bytes or an https URL). Storage key becomes
  `<owner_id>/<asset_id>`. `assets.holder_id` goes away as the ownership link;
  `owner_id` replaces it.
- **References.** A separate table records every use:

  ```
  asset_references(
    asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    referrer_kind text NOT NULL,   -- 'corpus' | 'microsite'
    referrer_id   uuid NOT NULL,   -- corpus_notes.id | microsites.id
    PRIMARY KEY (asset_id, referrer_kind, referrer_id)
  )
  ```

  A corpus note references an asset when it is the cover (`cover_image_asset_id`)
  or the body contains `standmeet-asset:<id>`. A microsite references one when its
  source uses it. Each referrer owns its own reference rows and rewrites them
  inside its own write transaction (the same place it already diffs body refs).

## The invariant (what the tests must prove)

**An asset with any `asset_references` row cannot be deleted.** `DeleteAsset`
first reads the references; if any exist it refuses with `ErrAssetReferenced` and
returns the referrers (kind + id + a human label) so the UI can say *"used by
these — remove them first"*. Only an unreferenced asset is deleted (row + MinIO
blob). The referrer side removes its own reference rows when the note / microsite
is deleted or stops using the asset — so "referenced" always reflects live use.

`ON DELETE CASCADE` on `asset_id` is belt-and-suspenders only: the guard means
an asset delete never reaches a referenced row. The load-bearing cleanup is the
referrer deleting its own rows.

## Migration (existing data must keep working)

Existing assets are holder-owned corpus images. The migration:
1. adds `assets.owner_id` (backfilled from the holder note's owner), makes
   `holder_id` nullable;
2. seeds `asset_references('corpus', holder_id)` for every existing asset, so
   today's covers/body-images are preserved as references from day one;
3. leaves the blobs in place (storage key is unchanged for existing rows; only
   new pool uploads use `<owner_id>/<asset_id>`).

A fresh install gets the new shape directly from `schema.sql`.

## References are computed at save (decided 2026-09-05)

A note/microsite's references are **not** hand-maintained per action — they are
**recomputed from its content on every save**, and set to exactly that set. This is
the single rule that makes reuse work and keeps references honest:

- **A corpus entry references** the assets its body cites (`standmeet-asset:<id>`)
  plus its cover (`cover_image_asset_id`). On every create/update the reference set is
  recomputed from that content (`RebuildNoteAssetRefs`). So editing an image out of the
  body **auto-frees** its reference (#3), and citing the same pool asset from a second
  entry **creates** a second reference (#1) — true reuse, with the guard counting both.

  The recompute is a **diff over content-driven references**, not a blanket
  delete-and-reinsert, because two kinds of reference are *not* content-driven and must
  survive an unrelated save:
  - **Attachments** (a PDF in the download area, `kind='attachment'`) are attached to the
    entry and listed there, never cited in the body — referenced by attach, freed by
    explicit detach (`DeleteNoteAsset`).
  - **An entry's own uploads** (`holder_id == note_id`) stay attached to the entry that
    created them whether or not its body/cover cites them — that's the per-entry asset
    panel's working set. Only an image **reused from the pool** (`holder ≠ note`) is
    purely content-driven: cited in → referenced, cited out → freed.

  So the recompute drops only the note's references to *reused* pool images it no longer
  cites, and inserts the currently-cited set (idempotent). Attachments and the entry's own
  uploads are left untouched.
- **A microsite references** the assets its built source uses (the asset widget),
  recomputed the same way on build/publish, `referrer_kind = 'microsite'`.
- **Uploading is pool-first.** Adding a *new* asset just puts it in the pool
  (owner-owned, unreferenced); the reference appears when the content cites it and
  is saved. There is no "attach to this note" that references without the content
  citing it — the content is the single source of truth.

**How the owner cites a pool asset (decided):**
- **corpus:** a **slash command** in the editor — pick from the pool (or upload a
  new one → pool), which inserts `standmeet-asset:<id>` into the body.
- **microsite:** an **asset widget** in the SDK that references a pool asset by id.

Consequence for existing behavior: `assets.upload` becomes "upload to the pool"; a
note's asset list is its computed references (body + cover), not everything ever
attached. Tests that asserted "attach → immediately on the note without saving the
body" move to "cite in body → save → referenced".

## Touchpoints

- **corpus write/delete** (`corpus_write.go` + note delete): create/rewrite
  `asset_references('corpus', note_id)` from the note's cover + body refs, in the
  same transaction; on note delete, drop its reference rows (assets survive in the
  pool).
- **microsite write/delete**: same, `referrer_kind='microsite'`.
- **asset usecase**: `UploadToPool`, `ListPool`, `DeleteAsset` (guarded),
  `ReferencesOf` (who references).
- **admin routes**: `Resources → Assets` (list + upload + delete-with-guard +
  who-references) and `Resources → Data` (per-microsite store viewer, backend
  already exists via capstore). Nav gets a `resources` group: Pages | Assets | Data.

## Stages (each ships test-first, its own commit)

1. schema + migration + `asset_references` + `DeleteAsset` guard + reference
   queries — guard test: a referenced asset refuses delete and names the referrer.
2. corpus write/delete maintain their reference rows (test: editing/removing a
   cover or body image updates references; deleting the note frees the asset).
3. pool upload + list + microsite references.
4. frontend: Resources nav + Assets manager + Data viewer + e2e.

## Test matrix (the error-prone scenarios — all must be covered)

The whole risk lives in the reference bookkeeping and the delete guard. Every row
here is a required test; most are e2e through the real DB + MinIO.

**Delete guard**
- referenced by a corpus entry → delete refused, message names that entry.
- referenced by a microsite → delete refused, message names that microsite.
- referenced by both → refused, names both.
- unreferenced → deletes: assets row gone AND MinIO blob gone.
- delete scoped to owner: owner A cannot delete owner B's asset (404, not 403 — no existence leak).

**Reference lifecycle (references must mirror live use exactly)**
- set a note's cover → one reference appears; clear the cover → reference gone → asset now deletable.
- add a `standmeet-asset:<id>` to a body → reference appears; remove it → reference gone.
- note update that swaps image A→B → A's reference removed, B's added (not both, not neither).
- delete the note → all its references gone, **the asset survives in the pool** (not deleted).
- **shared asset:** two notes reference one asset → deleting one note leaves the other's
  reference → asset still refuses delete until both referrers are gone. (The classic bug:
  deleting one referrer nukes a still-shared asset.)

**Pool upload**
- standalone upload (no holder) → asset in the pool, zero references, immediately deletable.
- list shows only the owner's assets, newest first; owner B's are absent.

**Migration (existing data)**
- an existing holder-owned cover/body image → owner_id backfilled from the holder note,
  a `'corpus'` reference seeded → it shows in the pool AND refuses delete while the note lives.
- an asset whose holder note no longer exists → row dropped, migration doesn't fail.
- existing blobs keep serving at their original storage keys; new pool uploads use `<owner_id>/…`.

**Reference integrity under concurrency / re-runs**
- InsertAssetReference is idempotent (ON CONFLICT DO NOTHING) — re-saving a note twice
  doesn't double-count or error.
