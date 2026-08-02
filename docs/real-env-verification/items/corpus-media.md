# corpus-media — Corpus: attachments → real object store → presigned render

- **Module:** an ingested asset (pasted image / `assets.upload` / vault attachment) lands as a media object in the real bucket, the body rewrites to the object URL, the public page renders it through a presigned/public URL built on the prod storage origin, and export round-trips the bytes. **Media belongs to EVERY genre** — raw / wiki / output carry attachments, inline images and a hero area (image + headline + hue) exactly as writing does; an asset's visibility is purely inherited from its holder entry, it has no ACL of its own.
- **Surface:** Tiptap editor (paste image) + `/writings` (cover render) + **`/admin/corpus` entry editor (hero + attachments on raw/wiki/output)** + **the wiki/output reader (hero render + attachment download)** + public page.
- **Real dep:** real MinIO / S3-compatible store in a prod posture (`STORAGE_USE_SSL`, `STORAGE_PUBLIC_URL`), optionally real S3/R2. For the per-genre checks: a real image host serving over **https** (the server fetches the URL itself; plain http is refused by design) and a real PDF to attach.
- **Backing e2e:** `writings` (presigned cover) · `obsidian-sync` (attachment → MinIO → export round-trip) · `sync-g-hidden` (attachment-not-note) · `genre-assets` (per-genre upload / hero / attachment / delete-cascade / fetch guards / per-kind size caps) · `genre-assets-inherit` (visibility inherits from the holder entry).

> **Naming note:** `upload_media` appears in older audit prose and design notes but **was never implemented**. The real tool is `assets.upload {genre, id, url, kind, filename}` — the server fetches the https URL itself; no bytes are posted through MCP.

## Checks

### 1 — `upload_media` → real object store → presigned URL renders  (was §I1)
- **Steps:** owner ingests an asset (paste image into Tiptap / `upload_media` via MCP / vault attachment `![[pixel.png]]`) → the object lands in the real bucket → the public page renders it through a presigned/public URL → fetch that URL and confirm the bytes come back.
- **Expected:** the object is stored in the real bucket, the `cover_image`/inline URL resolves, the fetched bytes match what was uploaded; export round-trips the same bytes.
- **⚠️ mock gap:** prod compose ships `STORAGE_USE_SSL=false` even in the prod profile — verify a real store fronted by TLS (or a real S3/R2 endpoint) works with SSL on, since CI never exercises the `https://` object path or a real `STORAGE_PUBLIC_URL`.
- **Backing test:** `writings.spec.ts:136` · `writings.spec.ts:174` · `obsidian-sync.spec.ts:78`
- **Result:** ✅ — cover + embedded images render on real notes (this round); presigned object-store URLs resolve.
### 2 — Real attachments / images (media not note)  (was §L6)
- **Steps:** import a real note referencing an image; confirm the attachment (non-`.md`) becomes a media object (not a note), body `![[img]]`/`![](img)` rewrites to the object URL, `cover_image` frontmatter inlines to a `pending-<uuid>` ref then resolves, `canonicalExt` normalizes the extension. Export and confirm bytes round-trip.
- **Expected:** attachment lands as media (exactly the notes count for `.md`, images excluded); presigned/object URL renders; export writes the blob into `attachments/` byte-identical.
- **⚠️ mock gap:** `sync-g-hidden` uses a synthetic 1×1 PNG; real vaults carry heavier/varied image types and real `cover_image` refs.
- **Backing test:** `sync-g-hidden.spec.ts` · `obsidian-sync.spec.ts`
- **Result:** ✅ — real attachments/images render (media-not-note path).
### 3 — `STORAGE_PUBLIC_URL` / `STORAGE_USE_SSL` prod values  (was §N5)
- **Steps:** confirm prod sets `STORAGE_USE_SSL=false` (`docker-compose.prod.yml:76`) and `STORAGE_PUBLIC_URL=${STORAGE_PUBLIC_URL}` (`:78`). Upload a real cover/media asset → confirm the `standmeet-asset:<id>` URI resolves to a presigned URL built on the prod `STORAGE_PUBLIC_URL` and renders on `/writings`.
- **Expected:** presigned URLs are minted against the owner's real public storage origin and render browser-side; `STORAGE_USE_SSL=false` is intentional (TLS terminates at the front proxy, storage is plain-http inside the compose network) — the browser-facing URL must be the public origin, not internal `minio:9000`.
- **Backing test:** `writings.spec.ts:136` · `resume-pdf-render.spec.ts:55`
- **Result:** ✅ — prod STORAGE_* values serve images on the live prod stack (covers rendered this round).
### 4 — A hero on a NON-writing entry: owner sets it, visitor sees it
- **Steps:** in `/admin/corpus`, open a **wiki** entry (repeat for **output** and **raw**) → set its hero: pick/attach an image, type the headline that sits over it, choose the hue → save → open that entry in the **public/invited reader** and look at the top of the page.
- **Expected:** the entry editor offers all **three** hero fields together (image + headline + hue — the design's Cover is one unit, not "a picture"); after save they persist across a reload; the reader renders the hero image with the headline over it in the chosen hue, the same way a writing's cover renders. An entry with no hero renders no empty hero shell (hide-the-whole-section, the F-A-21 family).
- **⚠️ mock gap:** `genre-assets` drives hero through **MCP only** and asserts the three fields read back over the API. Nothing drives the admin editor, and nothing renders a hero for wiki/output/raw — so a missing affordance or an unrendered hero is invisible to CI.
- **Backing test:** `genre-assets.spec.ts` (`${genre}:hero 区(图 + 标题句 + 色调)挂得上、读得回`)

### 5 — An attachment on a NON-writing entry: the download button
- **Steps:** attach a real PDF to a wiki entry from `/admin/corpus` → save → open that entry in the reader → find the download affordance → click it and confirm the file downloads and opens.
- **Expected:** the reader shows a download control carrying **the filename and the size** (the design's `DOWNLOAD PDF · 0.2 MB` — so the size must be the real byte count, not a placeholder); clicking it fetches the real bytes from the real bucket. The editor accepts a non-image attachment without an image-only guard rejecting it.
- **⚠️ mock gap:** CI asserts `kind`/`original_filename`/`size_bytes` come back over the API and that the presigned URL fetches — it never renders a button, so "the size renders as `NaN MB`" or "no button at all" passes CI.
- **Backing test:** `genre-assets.spec.ts` (`${genre}:附件(PDF)传得上,带着文件名和大小读得回`)

### 6 — Deleting the entry takes its media with it (real bucket)
- **Steps:** attach an image + a PDF to a wiki entry → note where they render → delete the entry from `/admin/corpus` → reload the reader and re-open any URL you had for those files.
- **Expected:** the entry is gone and **its files are gone from the real bucket** — the previously-working object URLs stop serving. No orphan bytes survive an entry deletion (blob lifetime ⊆ entry lifetime).
- **⚠️ mock gap:** the e2e deletes via MCP against dev MinIO; a real store with versioning / soft-delete / a lifecycle policy can keep serving an object the app believes it deleted.
- **Backing test:** `genre-assets.spec.ts` (`${genre}:删掉这条语料 → 它的素材跟着没`)

### 7 — Media inherits the entry's visibility (no side door)
- **Steps:** put an image on a wiki entry that one access code **can** read and another **cannot**. Open the reader as each visitor in turn. Then take the image's URL you got as the permitted visitor and open it as the other one.
- **Expected:** the permitted visitor sees the image; the excluded visitor gets neither the entry nor any trace of its media (no filename, no thumbnail, no broken-image slot hinting something is there). An asset is reachable **only** by way of an entry the viewer may read — knowing its id buys nothing.
- **⚠️ mock gap:** `genre-assets-inherit` proves the API shape; it can't see a UI that leaks a filename or a placeholder box on a denied entry. Note that a **presigned URL already handed out stays valid until it expires** — that is the store's contract, not a leak, but confirm the TTL on the real store is short enough to be acceptable.
- **Backing test:** `genre-assets-inherit.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Pasted/cover images actually **render** on the public page and `/writings` (not a broken-image icon or a dead `standmeet-asset:` URI).

**Per-genre media (the cold sweep, task-free):** open a raw, a wiki and an output entry in `/admin/corpus` and ask only *"could I put a picture on this?"* — is there any affordance at all, and does clicking it do something (dead-affordance lens, the F-N-1 / F-L-1 family)? Then open the same entries in the reader: does a hero render, does an attachment render as a real button with a real size, or does the page silently drop what the editor accepted? **Cross-view consistency:** an entry that the editor shows as carrying 2 files should show 2 in the reader — a media count that disagrees with what renders is the F-D-1 / F-L-4 shape. **Thesis lens:** writings get a designed Cover component while the other genres get nothing — if that asymmetry is deliberate it should be stated somewhere; if it isn't, it is the product contradicting its own "every genre is one corpus".

## Findings
(record here; also log `../findings.md`, ID `F-I-n` / `F-L-n` / `F-N-n` historical anchor)

- **pipeline PASS (2nd pass):** MinIO live; the render pipeline is proven working (see [[application-commit]] for the gotenberg leg).
