# application-commit — Jobs: PDF+QR render → committed application → recruiter loop

- **Status:** ⬜ not started (new round)
- **Module:** `applications.commit` renders a real ATS-friendly PDF via hardened gotenberg with a scannable QR top-right, issues an AccessCode, and the QR closes the loop — a recruiter scan lands on `/{handle}?code=` skipping `/gate` into a real-LLM owner-voice answer.
- **Surface:** owner MCP (`applications.commit`) → PDF artifact → recruiter's phone → visitor chat.
- **Real dep:** real gotenberg (hardened Chromium posture) + real DeepSeek (the recruiter's answer) + `[PHONE]` (a physical camera) for the last layer.
- **Backing e2e:** `resume-pdf-render` · `applications-commit` · `applications-commit-qr-works` · `qr-code-absorb` · `_render-sample-pdfs` · `integration-job-loop`.

## Checks

### 1 — Resume/report PDF via real gotenberg + real print view; QR resolves  (was §I2)
- **Steps:** run one `applications.commit` (or a report render) end-to-end → gotenberg renders the print view to PDF on the **hardened prod** Chromium posture → download → confirm a real multi-page US-Letter document with tailored content, and the QR top-right decodes to `/{handle}?code=…`.
- **Expected:** a well-formed PDF with correct pagination, embedded fonts, no missing glyphs, no unresolved network assets; the QR decodes to the correct visitor URL.
- **⚠️ mock gap:** dev gotenberg is **permissive** (`--chromium-deny-list=` empty, JS on), so CI never proves the render survives a **hardened prod Chromium posture** (populated deny-list, `network-idle` waits, bundled fonts, SSL). A print view depending on an external font/script would render in dev and break (blank/partial) in prod.
- **Backing test:** `resume-pdf-render.spec.ts:55` · `applications-commit.spec.ts:43` · `applications-commit-qr-works.spec.ts:34` · `qr-code-absorb.spec.ts:31` · `_render-sample-pdfs.spec.ts:34`
- **Result:** ⬜
### 2 — Recruiter physical closed loop (phone-last)  (was §Q1)
Three layers, verifiable independently, hardest last:
- **Layer 1 — QR decodes to the correct URL (programmatic, runnable now):** render the real commit PDF → extract the QR → decode programmatically (`zbarimg`) → assert the decoded string is exactly `/{handle}?code=<CODE>`; the URL hit directly skips `/gate` and opens a session.
  - `applications-commit-qr-works.spec.ts:34` · `qr-code-absorb.spec.ts:31` · `applications-commit.spec.ts:43`
- **Layer 2 — a real scanner app decodes the printed QR (Android emulator):** point an emulator camera + a real QR-scanner app at the displayed PDF → it opens the URL. `manual-only` (no emulator harness).
- **Layer 3 — real print → photo with a physical phone (`manual-only`, do LAST):** physically print → scan the top-right QR with a **real phone camera** → land in the ChatRoom → ask → get a **real-LLM owner-voice answer**.
- **⚠️ mock gap:** today the "scan" is `page.goto('/?code=…')` and the answer is **scripted** — the real optics + real-LLM answer are never walked. `manual-only` per sop.md iron rule 3.
- **Backing test:** `integration-job-loop.spec.ts:45` (scans QR → ChatRoom, but `page.goto`, scripted) · `:65` (session carries application context)
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The committed PDF opens as a real document (not blank/partial); the QR is crisp with a quiet zone (scan-viable); the recruiter's landing skips `/gate` cleanly.

## Findings
(record here; also log `../findings.md`, ID `F-I-n` / `F-Q-n` historical anchor)

- **pipeline PASS (2nd pass):** gotenberg up (chromium+libreoffice), rendered the live app page → a real 102 KB PDF over the actual network. Config sound: `GOTENBERG_URL` + `PRINT_BASE_URL` (network alias), `STORAGE_USE_SSL=false`. Resume PDF is host-side (not sandbox → not F-A-1-blocked).
