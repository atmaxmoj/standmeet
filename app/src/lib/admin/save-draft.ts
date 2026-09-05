// save-draft —— the composer's persistence. Before this, everything typed in the composer was
// local React state discarded at send; now the composer debounce-saves through PATCH /drafts/{id},
// so the "saved" label is real and commit renders what the owner actually sees.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { draftToAPIContent, type DraftModel } from '@/lib/admin/draft-model';

// saveDraft —— persist the whole edited draft (content + chosen Typst template).
export function saveDraft(model: DraftModel): Promise<void> {
  return adminAPI.patchVoid(`/drafts/${model.id}`, {
    template: model.template,
    resume_content: draftToAPIContent(model),
  });
}

// fetchTemplates —— the Typst layouts the picker offers (classic / compact / …).
export function fetchTemplates(): Promise<string[]> {
  return adminAPI.get('/drafts/templates', z.array(z.string()));
}

// previewURL —— the real Typst render for this draft. The `v` cache-buster forces the preview
// <iframe> to reload after each save so the owner sees the persisted result, not a stale render.
export function previewURL(draftID: string, version: number): string {
  return `/api/admin/drafts/${draftID}/preview.pdf?v=${version}`;
}
