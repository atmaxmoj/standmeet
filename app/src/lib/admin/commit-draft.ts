// commit-draft —— where the panel's `SEND →` button lands: POST /api/admin/drafts/{id}/commit.
//
// Why this file exists (F-E-9): `DraftsSection` used to pass `onSend` in as
// `onClose`. So the confirmation dialog promised, line by line, "freeze the
// snapshot / render a PDF with a QR / write an application row / auto-issue
// a 180-day code" — but clicking it just closed the panel. No request was
// sent, and nothing errored. The owner would think they'd applied.
//
// Both backend paths hit the **same** usecase (`jobsuc.CommitApplication`);
// this file just wires the panel up to it.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const CommittedSchema = z.object({
  application_id: z.string(),
  access_code: z.string(),
  qr_url: z.string(),
});

export type Committed = z.infer<typeof CommittedSchema>;

// CodeChoice —— the composer's code-picker decision. mode 'new' issues a fresh access code (the
// default); 'existing' reuses codeId (the résumé's QR carries that code — no new one issued).
export interface CodeChoice {
  mode: 'new' | 'existing';
  codeId: string;
}

export function commitDraft(id: string, choice: CodeChoice): Promise<Committed> {
  return adminAPI.post(
    `/drafts/${id}/commit`,
    { code_mode: choice.mode, code_id: choice.codeId },
    CommittedSchema,
  );
}
