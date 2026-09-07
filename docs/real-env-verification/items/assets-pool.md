# assets-pool — one pool of files, and nothing referenced can vanish

- **Module:** Uploaded files live in one instance-wide pool rather than inside whichever entry first used them. Any entry, writing or microsite can point at a pooled file; the pool knows who points at each one, and refuses to delete a file that something still needs.
- **Surface:** `/admin/assets` (the pool, with each file's references) and `/admin/data`; the reuse picker inside the corpus editor; the microsite `AssetWidget`.
- **Real dep:** Real object storage in a prod posture (`STORAGE_USE_SSL`, `STORAGE_PUBLIC_URL`). A file large enough that a truncated upload is visible — a multi-megabyte PDF, not a placeholder.
- **Exclusive:** none
- **Backing e2e:** `assets-manager-ui` · `global-assets-guard` · `asset-reference-recompute` · `corpus-asset-pool-reuse-ui` · `microsite-asset-widget` · `genre-assets` · `genre-assets-admin` · `genre-assets-inherit` · `genre-assets-reader`.

## Checks

### 1 — A file referenced by something cannot be deleted, and the refusal names who ⭐
- **Steps:** Upload a file and attach it to an entry. Try to delete it from the pool.
- **Expected:** The delete is refused, and the message names the entry that references it. Detach it there, then delete again: it goes.
- **Backing test:** `global-assets-guard.spec.ts`

### 2 — The reference count is recomputed on save, not on upload
- **Steps:** Attach a pooled file to a second entry. Read its references. Then edit that entry's body to remove the reference and save. Read them again.
- **Expected:** The list gains the second entry, then loses it. It agrees with what the entries actually contain at the moment it is read.
- **Mock gap:** The recompute runs on a real save through the editor; a fixture that writes the join table directly proves nothing about it.
- **Backing test:** `asset-reference-recompute.spec.ts`

### 3 — The same file serves two entries without being uploaded twice ⭐
- **Steps:** Open a second entry's editor and use the reuse picker to attach a file already in the pool. Read the pool.
- **Expected:** One row in the pool, two references. The second entry renders the file.
- **Backing test:** `corpus-asset-pool-reuse-ui.spec.ts`

### 4 — A microsite can render a pooled file
- **Steps:** Put an `AssetWidget` pointing at a pooled file into a microsite, build it, and open the live page.
- **Expected:** The file renders on the page, and the pool counts that microsite among its references.
- **Backing test:** `microsite-asset-widget.spec.ts`

### 5 — Every genre can carry attachments
- **Steps:** Attach a file to a raw entry, a wiki entry and a writing in turn. Open each on its reader surface.
- **Expected:** Each shows its own attachment. No genre silently drops one.
- **Backing test:** `genre-assets-admin.spec.ts` · `genre-assets-reader.spec.ts` · `genre-assets-admin-raw-subj.spec.ts`

### 6 — A real multi-megabyte file arrives whole
- **Steps:** Upload a multi-megabyte PDF through the panel. Download it back from the reader surface and compare the size.
- **Expected:** The bytes match. The upload reports progress or completion rather than appearing to finish instantly.
- **Mock gap:** A fixture uploads a tiny file, so neither a size ceiling nor a truncating proxy can show itself.
- **Backing test:** `assets-manager-ui.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The pool's own numbers are the claim: a row that says how many things reference a file must agree with the list that opens when you ask which ones.

An asset appears on three surfaces — the pool, the entry that uses it, and the reader page that renders it. Name any file present on one and missing from another.

Every affordance in the pool acts on the file under it: a delete that does nothing on a referenced file is correct only if it says why, and a reuse picker that lists a file must be able to attach it.
