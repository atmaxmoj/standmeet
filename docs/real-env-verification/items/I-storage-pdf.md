# §I — Storage / PDF / deploy

- **Status:** ⬜ not-run
- **Scope:** `I1-I3 runnable-now` · `I4 🚫 de-scoped (provider)`
- **Prereqs/creds:** none required for I1–I3 beyond the real prod stack (`make prod-up`). Dev MinIO / dev gotenberg are *real software* already, so the mock-free version is really about running them in a **prod-grade posture** (SSL, hardened Chromium), optionally against real S3/R2 (`[STORAGE]`). I4 needs `[DEPLOY]` (a real domain + host on 80/443) — **de-scoped**, see below.
- **Real service:** real MinIO / S3-compatible object store (replacing nothing faked — the dev instance is real but permissive) · real **gotenberg** Chromium PDF render · real **TLS** termination (Caddy/Traefik + ACME). The mocks being displaced are the *permissive dev defaults* (`--chromium-deny-list=` empty, JS on, `STORAGE_USE_SSL=false`), not a scripted stub.
- **Backing e2e:** (attribution targets) `resume-pdf-render` · `applications-commit` · `applications-commit-qr-works` · `qr-code-absorb` · `resume-draft-preview` · `_render-sample-pdfs` · `writings` (upload_media / presigned cover) · `obsidian-sync` (attachment → MinIO → export round-trip)

> Note on scope: I1–I3 are all reachable on the local prod stack with no external credentials — the object store and gotenberg are containers we already run; the only "real" delta is the prod hardening posture. I4 (real ACME/DNS) is the one sub-item with no owner-journey; it is marked `🚫 de-scoped` and must not be silently assumed done.

## Sub-items

### I1 — `upload_media` → real object store → presigned URL renders
- **Steps:** owner ingests an asset (paste an image into the Tiptap editor / `upload_media` via MCP / a vault attachment `![[pixel.png]]`) → the object lands in the real bucket → the public page renders it through a presigned/public URL → fetch that URL and confirm the bytes come back.
- **Expected:** the object is stored in the real bucket, the `cover_image`/inline URL resolves, and the fetched bytes match what was uploaded. Export round-trips the same bytes.
- **⚠️ mock gap:** prod compose ships `STORAGE_USE_SSL=false` (inventory §I1, `[scan]`) even in the prod profile — verify a real store fronted by TLS (or a real S3/R2 endpoint) actually works with SSL on, since CI never exercises the `https://` object path or a real `STORAGE_PUBLIC_URL`.
- **Backing test:** `writings.spec.ts:136` (owner uploads cover image → presigned render) · `writings.spec.ts:174` (paste image → presigned URL, body stores URI) · `obsidian-sync.spec.ts:78` (attachment → MinIO store + body rewrite + export bytes)
- **Result:** ⬜

### I2 — Resume/report PDF via real gotenberg + real print view; QR resolves
- **Steps:** run one `applications.commit` (or a report/summary render) end-to-end → gotenberg renders the print view to PDF on the **hardened prod** Chromium posture → download the PDF → confirm it is a real multi-page US-Letter document with the tailored resume content, and that the QR printed top-right decodes to `/{handle}?code=…`.
- **Expected:** a well-formed PDF with correct pagination, embedded fonts, no missing glyphs, no unresolved network assets; the QR decodes to the correct visitor URL.
- **⚠️ mock gap:** dev gotenberg is **permissive** — `--chromium-deny-list=` is empty and JS is on (inventory §I2, `[scan]`), so CI never proves the render survives a **hardened prod Chromium posture**: a populated deny-list (blocking private-network/file fetches), `network-idle` waits, bundled fonts, and SSL. A print view that silently depends on an external font/script or a same-host private fetch would render fine in dev and break (blank/partial PDF) in prod. Verify the render on the prod deny-list config.
- **Backing test:** `resume-pdf-render.spec.ts:55` (committed PDF: 2 US-Letter pages with real resume content) · `applications-commit.spec.ts:43` (draft → commit → QR points at owner) · `applications-commit-qr-works.spec.ts:34` (issued code opens a session) · `qr-code-absorb.spec.ts:31` · `_render-sample-pdfs.spec.ts:34` · `resume-draft-preview.spec.ts:33`
- **Result:** ⬜

### I3 — Custom-page sandbox build → real static hosting
- **Steps:** owner submits a custom React page using the SDK → the sandbox runs a **real Vite build** → the static output is hosted on the instance and served → open the built page and confirm it renders/chats.
- **Expected:** the real build succeeds in the sandbox (not a stubbed toolchain) and the static artifact is served from the instance.
- **Note:** the sandbox/build isolation itself is verified under **§K** (K2 prod docker-driver); here we only care that the *storage + hosting* of the built artifact works on the prod stack.
- **Backing test:** covered indirectly — no dedicated custom-page-build storage spec in `e2e/test/` (gap); nearest is `custom-page.spec.ts` for the page surface and §K sandbox specs for the build.
- **Result:** ⬜

### I4 — Real domain + Let's Encrypt TLS  🚫 de-scoped
- **Steps (documented, not run):** CNAME a real domain at the instance → `/internal/tls-ask` gates the on-demand cert → ACME auto-signs → `https://<domain>` serves the owner page.
- **Status:** **🚫 de-scoped.** Real ACME/DNS is **provider territory** — roadmap 块三 (prod-deploy) was cut by decision (the provider owns cert wiring, domain, and 80/443). So "CNAME your domain and it just works" has **no owner-journey** in StandMeet's scope. This sub-item is named here only so it is not *assumed* verified; there is nothing for the owner to walk.
- **Backing test:** none (and none owed — de-scoped, not a gap).
- **Result:** 🚫 de-scoped

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-I-n`)
