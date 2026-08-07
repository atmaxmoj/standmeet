# application-commit — Jobs: PDF+QR render → committed application → recruiter loop

- **Module:** `applications.commit` renders an ATS-friendly PDF through a real headless-Chromium service, prints a scannable QR top-right, and issues an access code. The QR closes the loop: a recruiter scan lands on `/{handle}?code=`, skips the gate, and reaches a real answer in the owner's voice.
- **Surface:** Owner MCP (`applications.commit`) → the PDF artifact → a recruiter's phone → visitor chat.
- **Real dep:** A real render service on the hardened prod posture, a real model for the recruiter's answer, and a physical camera for the last layer. A committed application must exist, which needs a live job in the pool first.
- **Backing e2e:** `resume-pdf-render` · `applications-commit` · `applications-commit-qr-works` · `qr-code-absorb` · `_render-sample-pdfs` · `integration-job-loop`.

## Checks

### 1 — The PDF is a real document, rendered on the prod posture ⭐
- **Steps:** Run one `applications.commit`. Download the PDF. Open it. Page through it. Look for missing glyphs and for assets that failed to load.
- **Expected:** A well-formed multi-page US-Letter document with tailored content, correct pagination, embedded fonts, no missing glyphs, and no unresolved network assets.
- **Mock gap:** The dev render service is permissive — empty deny-list, JS enabled — so CI never proves the render survives the hardened prod posture. A print view depending on an external font or script renders in dev and comes out blank or partial in prod.
- **Backing test:** `resume-pdf-render.spec.ts` · `applications-commit.spec.ts` · `_render-sample-pdfs.spec.ts`

### 2 — The QR decodes to the right URL
- **Steps:** Extract the QR from the rendered PDF. Decode it programmatically. Open the decoded URL directly.
- **Expected:** The decoded string is exactly the visitor URL carrying this application's code. Opening it skips the gate and opens a session.
- **Backing test:** `applications-commit-qr-works.spec.ts` · `qr-code-absorb.spec.ts`

### 3 — A scanner app decodes the QR off a screen
- **Steps:** Display the PDF. Point a real QR-scanner app at it. Follow what it opens.
- **Expected:** The scanner decodes it and opens the visitor URL.
- **Mock gap:** No emulator harness exists, so this is driven by hand.
- **Backing test:** `gap`

### 4 — A printed page, a phone camera, and a real answer
- **Steps:** Print the PDF on paper. Scan the top-right QR with a phone camera. Land in the chat. Ask a question. Read the answer.
- **Expected:** The optics work off paper, the session opens, and the answer comes back in the owner's voice from a real model.
- **Mock gap:** In CI the "scan" is a direct navigation and the answer is scripted, so neither the optics nor the answer is ever exercised. Do this layer last.
- **Backing test:** `integration-job-loop.spec.ts` (navigation, scripted answer) · the physical loop → `gap`

### 5 — The session knows which application it came from
- **Steps:** Open the session through the QR's code. Read what the session carries.
- **Expected:** The session carries the application context, so the answer can speak to that role.
- **Backing test:** `integration-job-loop.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The PDF opens as a real document, never blank or half-rendered.
The QR is crisp and keeps its quiet zone, because a QR that cannot be scanned is a QR that does not exist.
The recruiter's landing skips the gate cleanly, with no flash of the code-entry page.
