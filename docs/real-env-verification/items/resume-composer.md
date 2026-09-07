# resume-composer — the owner lays out a résumé and the PDF matches it

- **Module:** The owner opens a résumé draft in a visual editor, moves and edits its parts on a paper canvas, and the committed PDF carries exactly what the canvas showed. The editor state is the owner's document, saved on demand, not on every keystroke.
- **Surface:** `/admin/drafts` (the list, the manual-new button, discard) and `/admin/edit-resume/<id>` (the canvas, its field panels, Save).
- **Real dep:** The prod backend image, which carries the typst binary and the Noto CJK fonts the PDF is rendered with. A draft to open: either created by hand from the list, or produced by the job loop (see [[resume-draft]]).
- **Exclusive:** none
- **Backing e2e:** `draft-puck-save` · `draft-puck-data-persist` · `draft-puck-dirty` · `draft-puck-field-edit` · `draft-puck-paper` · `draft-puck-section-order` · `draft-discard` · `drafts-manual-new` · `puck-editor-look` · `composer-pdf-fidelity` · `composer-cjk-renders` · `resume-composer-fidelity` · `resume-composer-sections` · `resume-pdf-render` · `resume-qr-host`.

## Checks

### 1 — What the canvas shows is what the PDF carries ⭐
- **Steps:** Open a draft. Change a field, move a section, and remove the content of one section. Save. Commit the application and open the produced PDF.
- **Expected:** Every edit is present in the PDF, in the order the canvas showed. A section left with no content appears nowhere in the PDF rather than as an empty heading.
- **Mock gap:** A spec can compare the form state against the stored `resume_content`; whether the rendered document agrees needs the real typst binary and its fonts.
- **Backing test:** `composer-pdf-fidelity.spec.ts` · `resume-composer-fidelity.spec.ts`

### 2 — Save is the only thing that writes
- **Steps:** Open a draft, change a field, and navigate away without saving. Reopen it. Then change a field, click Save, and reopen.
- **Expected:** The unsaved change is gone on reopening; the saved one is there. Leaving with unsaved changes asks first, and says what would be lost.
- **Backing test:** `draft-puck-save.spec.ts` · `draft-puck-data-persist.spec.ts` · `draft-puck-dirty.spec.ts`

### 3 — The document keeps its own colours in both themes ⭐
- **Steps:** Open a draft in light mode and read the canvas. Switch the admin to dark mode and read it again.
- **Expected:** The paper stays cream with ink text in both. Only the editor chrome around it follows the theme.
- **Backing test:** `draft-puck-paper.spec.ts` · `puck-editor-look.spec.ts`

### 4 — Sections and rows move by dragging, and the move reaches the document
- **Steps:** Drag a whole section above another. Drag one experience row above another inside a section. Save and render.
- **Expected:** Both orders change on the canvas and both orders are the ones the PDF prints.
- **Backing test:** `draft-puck-section-order.spec.ts` · `resume-composer-sections.spec.ts`

### 5 — A CJK résumé renders as characters
- **Steps:** Put Chinese text into a field. Save, commit, and open the PDF.
- **Expected:** The characters are legible in the PDF. No box glyphs anywhere.
- **Mock gap:** Font fallback is a property of the image the PDF is rendered in; a fixture cannot show a missing font.
- **Backing test:** `composer-cjk-renders.spec.ts`

### 6 — A period is two dates, and both survive the round trip
- **Steps:** Fill an experience row's start and end separately. Save, reopen, and render.
- **Expected:** Both values come back into their own fields, and both appear in the PDF.
- **Backing test:** `resume-composer-fidelity.spec.ts`

### 7 — The QR on the PDF opens this instance
- **Steps:** Commit an application. Scan the QR on the rendered PDF with a phone.
- **Expected:** It resolves to the instance's configured public URL carrying the issued code, and the page it opens is the visitor surface rather than the gate.
- **Mock gap:** The encoded host comes from configuration; only a scan off the rendered page shows what a recruiter actually gets.
- **Backing test:** `resume-qr-host.spec.ts`

### 8 — Discarding a draft removes it
- **Steps:** Discard a draft from the list and confirm. Reload the list.
- **Expected:** The draft is gone from the list and stays gone after a reload.
- **Backing test:** `draft-discard.spec.ts` · `resume-draft-discard.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Read the canvas as a document, not as a form: a first-time eye must be able to tell which part is the résumé and which part is the editor, without clicking anything.

The canvas, the preview and the committed PDF are three views of one document — name anything that appears in one and not the others, and anything whose position differs between them.

Every control on the canvas must do something to the document: a handle that does not drag, a field that does not reach the PDF, and a button disabled in every state are the same defect wearing different clothes.
