# corpus-media — Corpus: attachments → real object store → presigned render

- **Status:** ✅ **F-I-1 CLOSED** (2026-07-15) — check 1 ⑤-verified on the real public page: the cover loads. Check 2 is **N/A for this owner's vault** (it contains zero image attachments); the SSL/`https://` storage-origin leg remains unexercised.
- **Module:** an ingested asset (pasted image / `upload_media` / vault attachment) lands as a media object in the real bucket, the body rewrites to the object URL, the public page renders it through a presigned/public URL built on the prod storage origin, and export round-trips the bytes.
- **Surface:** Tiptap editor (paste image) + `/writings` (cover render) + public page.
- **Real dep:** real MinIO / S3-compatible store in a prod posture (`STORAGE_USE_SSL`, `STORAGE_PUBLIC_URL`), optionally real S3/R2.
- **Backing e2e:** `writings` (upload_media / presigned cover) · `obsidian-sync` (attachment → MinIO → export round-trip) · `sync-g-hidden` (attachment-not-note).

## Checks

### 1 — `upload_media` → real object store → presigned URL renders  (was §I1)
- **Steps:** owner ingests an asset (paste image into Tiptap / `upload_media` via MCP / vault attachment `![[pixel.png]]`) → the object lands in the real bucket → the public page renders it through a presigned/public URL → fetch that URL and confirm the bytes come back.
- **Expected:** the object is stored in the real bucket, the `cover_image`/inline URL resolves, the fetched bytes match what was uploaded; export round-trips the same bytes.
- **⚠️ mock gap:** prod compose ships `STORAGE_USE_SSL=false` even in the prod profile — verify a real store fronted by TLS (or a real S3/R2 endpoint) works with SSL on, since CI never exercises the `https://` object path or a real `STORAGE_PUBLIC_URL`.
- **Backing test:** `writings.spec.ts:136` · `writings.spec.ts:174` · `obsidian-sync.spec.ts:78`
- **Result:** ✅ **GREEN — F-I-1 fixed and ⑤-verified on the real public page (2026-07-15).** Was: served via Next `/_next/image?url=<presigned>` → **400**, `naturalWidth:0`, broken, 2 console errors. Now on real prod `/writings/media-verify`: the `<img src>` is the **direct presigned MinIO URL** (`localhost:9210/standmeet/ed394981…/7f1d1aa2…?X-Amz-…`), **not** `/_next/image` (`viaNextOptimizer:false`), and it **actually loads** — `naturalWidth:240 · naturalHeight:240 · complete:true`, zero console errors. Upload → real bucket → presign → browser render is end-to-end green. (The writing also survived the authoritative vault sync untouched, which is correct: it is admin-authored, so `obsidian_imported_at` is NULL and prune has no claim on it — see F-L-6.) Still unexercised: `STORAGE_USE_SSL=true` / a real `https://` `STORAGE_PUBLIC_URL` (prod compose ships SSL off).

### 2 — Real attachments / images (media not note)  (was §L6)
- **Steps:** import a real note referencing an image; confirm the attachment (non-`.md`) becomes a media object (not a note), body `![[img]]`/`![](img)` rewrites to the object URL, `cover_image` frontmatter inlines to a `pending-<uuid>` ref then resolves, `canonicalExt` normalizes the extension. Export and confirm bytes round-trip.
- **Expected:** attachment lands as media (exactly the notes count for `.md`, images excluded); presigned/object URL renders; export writes the blob into `attachments/` byte-identical.
- **⚠️ mock gap:** `sync-g-hidden` uses a synthetic 1×1 PNG; real vaults carry heavier/varied image types and real `cover_image` refs.
- **Backing test:** `sync-g-hidden.spec.ts` · `obsidian-sync.spec.ts`
- **Result:** ⚪ **N/A for this vault (verified, not skipped).** The real vault contains **zero image attachments** (`find` over the whole copy: 0 `.png/.jpg/.jpeg/.gif/.webp/.svg`, excluding `.git`), and only 2 notes carry any `![[…]]` embed at all. So "real attachments at real density" has nothing to drive against here — the honest disposition is N/A rather than a green or a red. The synthetic-PNG mechanics (attachment → media object not a note; export byte round-trip) stay covered by `sync-g-hidden` + `obsidian-sync`, and the new `sync-j-export` fidelity test proves non-`.md` files never become notes. Re-run this check if the owner's vault ever gains real images.

### 3 — `STORAGE_PUBLIC_URL` / `STORAGE_USE_SSL` prod values  (was §N5)
- **Steps:** confirm prod sets `STORAGE_USE_SSL=false` (`docker-compose.prod.yml:76`) and `STORAGE_PUBLIC_URL=${STORAGE_PUBLIC_URL}` (`:78`). Upload a real cover/media asset → confirm the `standmeet-asset:<id>` URI resolves to a presigned URL built on the prod `STORAGE_PUBLIC_URL` and renders on `/writings`.
- **Expected:** presigned URLs are minted against the owner's real public storage origin and render browser-side; `STORAGE_USE_SSL=false` is intentional (TLS terminates at the front proxy, storage is plain-http inside the compose network) — the browser-facing URL must be the public origin, not internal `minio:9000`.
- **Backing test:** `writings.spec.ts:136` · `resume-pdf-render.spec.ts:55`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Pasted/cover images actually **render** on the public page and `/writings` (not a broken-image icon or a dead `standmeet-asset:` URI).

## Findings
(record here; also log `../findings.md`, ID `F-I-n` / `F-L-n` / `F-N-n` historical anchor)

- **pipeline PASS (2nd pass):** MinIO live; the render pipeline is proven working (see [[application-commit]] for the gotenberg leg).
