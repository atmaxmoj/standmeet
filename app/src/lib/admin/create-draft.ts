// create-draft —— the drafts panel's "new draft" button: POST /api/admin/drafts.
// Claude normally creates drafts along the job-loop path (resume.draft); this is
// the owner starting one by hand. The draft starts from the chosen master (or
// blank), so the returned row already has content to open in the composer.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { BLANK } from '@/lib/admin/use-resume-masters';

export interface NewDraftInput {
  company: string;
  role: string;
  // start —— a master id, or BLANK.
  start: string;
}

const CreatedDraftSchema = z.object({ id: z.string() });
export type CreatedDraft = z.infer<typeof CreatedDraftSchema>;

export function createManualDraft(input: NewDraftInput): Promise<CreatedDraft> {
  const from = input.start === BLANK ? { blank: true } : { master_id: input.start };
  return adminAPI.post(
    '/drafts',
    { company: input.company.trim(), role: input.role.trim(), ...from },
    CreatedDraftSchema,
  );
}
