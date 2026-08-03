# corpus-media — Corpus: attachments → real object store → presigned render

- **Module:** an ingested asset (pasted image / `assets.upload` / vault attachment) lands as a media object in the real bucket, the body rewrites to the object URL, the public page renders it through a presigned/public URL built on the prod storage origin, and export round-trips the bytes. **Media belongs to EVERY genre** — raw / wiki / output carry attachments, inline images and a hero area (image + headline + hue) exactly as writing does; an asset's visibility is purely inherited from its holder entry, it has no ACL of its own.
- **Surface:** Tiptap editor (paste image) + `/writings` (cover render) + **`/admin/corpus` entry editor (hero + attachments on raw/wiki/output)** + **the wiki/output reader (hero render + attachment download)** + public page.
- **Real dep:** real MinIO / S3-compatible store in a prod posture (`STORAGE_USE_SSL`, `STORAGE_PUBLIC_URL`), optionally real S3/R2. **Both arrival paths get exercised:** the panel takes a **local file** (the browser hands over the bytes — no image host needed); MCP `assets.upload` takes an **https URL** the server fetches itself (plain http refused by design). Attachments need a **real multi-MB PDF**, not a placeholder.
- **Backing e2e:** `writings` (presigned cover) · `obsidian-sync` (attachment → MinIO → export round-trip) · `sync-g-hidden` (attachment-not-note) · `genre-assets` (per-genre upload / hero / attachment / delete-cascade / fetch guards / per-kind size caps) · `genre-assets-inherit` (visibility inherits from the holder entry) · `genre-assets-reader` (what the visitor's page actually renders: body image, hero, download row) · `genre-assets-admin` + `genre-assets-admin-raw-subj` (the panel's files panel across all four genres).

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
- **⚠️ mock gap:** the admin editor and the wiki/output readers ARE driven now (`genre-assets-admin`, `genre-assets-reader`) — what CI still can't see is the **image itself**: whether the presigned URL is built on the owner's `STORAGE_PUBLIC_URL` (not the container-internal `minio:9000`, which a browser cannot resolve), whether it is still inside its TTL when the page loads, and whether `cover_headline` stays legible over a real photograph — CI's fixture is a 1×1 pixel, so any text "passes" over it. An entry with **no** hero set must not render an empty hero shell either.
- **Backing test:** `genre-assets.spec.ts` (`${genre}:hero 区(图 + 标题句 + 色调)挂得上、读得回`)

### 5 — An attachment on a NON-writing entry: the download button
- **Steps:** attach a real PDF to a wiki entry from `/admin/corpus` → save → open that entry in the reader → find the download affordance → click it and confirm the file downloads and opens.
- **Expected:** the reader shows a download control carrying **the filename and the size** (the design's `DOWNLOAD PDF · 0.2 MB` — so the size must be the real byte count, not a placeholder); clicking it fetches the real bytes from the real bucket. The editor accepts a non-image attachment without an image-only guard rejecting it.
- **⚠️ mock gap:** CI now renders the download row and asserts filename + `size_bytes` + the `download` attribute (`genre-assets-reader`). What it can't do is **download**: whether the click lands a file on disk or opens the PDF as a page, and whether a real 4 MB PDF reads as `4.1 MB` rather than `NaN MB` / `4194304 B` — every CI fixture is tens of bytes, so the formatting branches never run.
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

### 8 — The output reader is the same product as the wiki reader
- **Steps:** on an output entry, attach an image and `insert into body`, set a cover plus a `cover_headline`, attach a real PDF → save → open `/output/<path>` as a visitor whose code grants `output://**` and read top to bottom: hero → inline image → download area. Then open the same URL with a code that does **not** grant output.
- **Expected:** all three render, and they look like the same设置 on a wiki entry — same component, same hero proportions, same download row with a real filename and a real size. The excluded visitor sees neither the entry nor any trace of its media.
- **⚠️ mock gap:** the output landing used to return only `path/title/body/excerpt/updated_at`, so a `standmeet-asset:<id>` in the body was **silently stripped** by react-markdown's urlTransform — an empty image slot, a clean console, and a body-text assertion that still passed. That class of failure (a hole with no exception) only shows up when you put the two genres side by side. This view is also the **SDK's public contract** (`sdk/packages/core/src/types.ts`), so a field added on one side and not the other surfaces first in an SDK consumer → glance at [[sdk-embed]].
- **Backing test:** `genre-assets-reader.spec.ts` (`output 的 reader 也渲素材`)
- **Result:** ⬜

### 9 — The files panel is in all four editors, and it takes a LOCAL file ⭐
- **Steps:** open, in turn, the `/admin/wiki` edit form, the `/admin/output` edit form, the `/admin/raw` **inline** edit form, and the `/admin/subjectivity` edit form. In each, ask the same run of questions: can you find the files panel → does "choose file" open a real picker and take a real file from this machine (a multi-MB photo, and a real PDF) → does the row that appears carry the **real filename and the real size** → does "insert in body" actually drop a line into the textarea → does "use as cover" show you anything → does "remove" make the row go away. Then feed it a file that **should** be refused (too large, or a type not accepted) and read what the UI says. Also upload a writings cover this way — writings now travels the same channel.
- **Expected:** the same control, the same buttons, in the same order in all four places (they are literally one `CorpusAssetsPanel` — if they look different on screen, one of them is mis-wired). Sizes read as human units (`0.2 MB`), never a byte count and never `NaN`. A refusal names the reason, not "something went wrong".
- **⚠️ mock gap:** the e2e feeds a few dozen bytes through `setInputFiles` — same JS path, but **no real file ever travels from a real picker through a real browser to real object storage**. Upload duration on a large file, the absence of any progress feedback, and the per-kind size caps against real files are all outside CI's reach.
- **Backing test:** `genre-assets-admin.spec.ts` · `genre-assets-admin-raw-subj.spec.ts`
- **Result:** ⬜

### 10 — Setting a cover must not wipe the entry's other fields ⭐
- **Steps:** find a **real** entry with a long body, tags, and (on raw) the private flag set → do exactly one thing: click "use as cover" in the files panel → save → reload and read the body, the tags and the flag back. Repeat on each genre.
- **Expected:** only the cover changed.
- **⚠️ why this is worth a human:** `corpus.update` replaces every non-hero field wholesale, so the cover has to be submitted **together with the body**. The day someone sends a cover-only update, the body is wiped — **and the save succeeds, with a green toast**. Same family as [[corpus-acl-editing]] check 5 / F-A-18 ("an edit form must not zero the fields it doesn't show"), one field over. The damage is silent and there is no undo on a real 223-note corpus.
- **Backing test:** none (gap) — step-3 owes one: a cover-only update asserting body/tags survive.
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Pasted/cover images actually **render** on the public page and `/writings` (not a broken-image icon or a dead `standmeet-asset:` URI).

**Per-genre media (the cold sweep, task-free):** open a raw, a wiki and an output entry in `/admin/corpus` and ask only *"could I put a picture on this?"* — is there any affordance at all, and does clicking it do something (dead-affordance lens, the F-N-1 / F-L-1 family)? Then open the same entries in the reader: does a hero render, does an attachment render as a real button with a real size, or does the page silently drop what the editor accepted? **Cross-view consistency:** an entry that the editor shows as carrying 2 files should show 2 in the reader — a media count that disagrees with what renders is the F-D-1 / F-L-4 shape. **Thesis lens:** writings get a designed Cover component while the other genres get nothing — if that asymmetry is deliberate it should be stated somewhere; if it isn't, it is the product contradicting its own "every genre is one corpus".

## Findings
(record here; also log `../findings.md`, ID `F-I-n` / `F-L-n` / `F-N-n` historical anchor)

- **pipeline PASS (2nd pass):** MinIO live; the render pipeline is proven working (see [[application-commit]] for the gotenberg leg).
