// create-draft —— the drafts panel's "new draft" button: POST /api/admin/drafts.
// Claude normally creates drafts along the job-loop path (resume.draft); this is
// the owner starting one by hand. The server carries resume_content over from the
// most recent draft, so the returned row already has content to open in the composer.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

export interface NewDraftInput {
  company: string;
  role: string;
}

const CreatedDraftSchema = z.object({ id: z.string() });
export type CreatedDraft = z.infer<typeof CreatedDraftSchema>;

export function createManualDraft(input: NewDraftInput): Promise<CreatedDraft> {
  return adminAPI.post(
    '/drafts',
    { company: input.company.trim(), role: input.role.trim() },
    CreatedDraftSchema,
  );
}
