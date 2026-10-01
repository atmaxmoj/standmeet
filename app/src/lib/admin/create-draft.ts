// create-draft —— the drafts panel's "new draft" button: POST /api/admin/drafts.
// Claude normally creates drafts along the job-loop path (resume.draft); this is
// the owner starting one by hand. The draft starts from the chosen master (or
// blank), so the returned row already has content to open in the composer.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { BLANK, DEFAULT } from '@/lib/admin/use-resume-masters';

export interface NewDraftInput {
  company: string;
  role: string;
  // start —— a master id, BLANK, or DEFAULT (the server picks the default master).
  start: string;
}

const CreatedDraftSchema = z.object({ id: z.string() });
export type CreatedDraft = z.infer<typeof CreatedDraftSchema>;

const STARTS: Record<string, object> = { [BLANK]: { blank: true }, [DEFAULT]: {} };

export function createManualDraft(input: NewDraftInput): Promise<CreatedDraft> {
  const from = STARTS[input.start] ?? { master_id: input.start };
  return adminAPI.post(
    '/drafts',
    { company: input.company.trim(), role: input.role.trim(), ...from },
    CreatedDraftSchema,
  );
}
