// save-draft —— the composer's persistence. Before this, everything typed in the composer was
// local React state discarded at send; now the composer debounce-saves through PATCH /drafts/{id},
// so the "saved" label is real and commit renders what the owner actually sees.

import { adminAPI } from '@/lib/api/admin';
import { draftToAPIContent, type DraftModel } from '@/lib/admin/draft-model';

// savePuckDraft —— the Puck editor's Save: persist the derived resume_content + template. This is the
// explicit commit-to-storage moment (Puck owns the state until Save; no autosave churn).
//
// puck_data is intentionally NOT persisted: resume_content is the single canonical source, and the
// editor re-derives its Puck document from it on open (puckInitialData). A stored second copy is
// exactly what drifted — the editor showed an empty puck_data while the listing thumbnail and the
// committed PDF rendered a populated resume_content.
export function savePuckDraft(model: DraftModel): Promise<void> {
  return adminAPI.patchVoid(`/drafts/${model.id}`, {
    template: model.template,
    resume_content: draftToAPIContent(model),
  });
}

// previewURL —— the draft's rendered PDF. The `v` cache-buster forces a reload after each save so the
// owner sees the persisted result, not a stale render. `code` is the picked access code (plaintext):
// the preview stamps the REAL QR for it (empty → the backend's placeholder marker).
export function previewURL(draftID: string, version: number, code = ''): string {
  const codeParam = code === '' ? '' : `&code=${encodeURIComponent(code)}`;
  return `/api/admin/drafts/${draftID}/preview.pdf?v=${version}${codeParam}`;
}

// resumeQRURL —— the address the résumé's QR encodes for a chosen access code: the owner's public
// URL with the code in the query (mirrors the backend's buildQRURL = `<public_url>?code=<plaintext>`
// so the live preview shows the SAME address the committed PDF will carry). Empty when either part
// is missing (no QR then).
export function resumeQRURL(publicURL: string, code: string): string {
  return publicURL === '' || code === '' ? '' : `${publicURL}?code=${code}`;
}
