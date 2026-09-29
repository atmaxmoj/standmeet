// use-admin-drafts —— the /admin/drafts list, one page at a time through the one paginator
// (docs/design/paging.md; resume drafts were "leave alone (TTL)" until the owner overruled it on
// 2026-09-29: "分页也要做好了，别忘了").

import { z } from 'zod';

import { ResumeContentSchema } from '@/lib/admin/draft-wire';
import { createPagedStore } from '@/lib/state/create-paged-store';

export type DraftStatus = 'reviewing' | 'draft' | 'sent';

// resume_content —— this is what the card's thumbnail renders. **Required**:
// if it were optional, the day the backend stops sending it, the thumbnail
// would quietly fall back to an empty document, and the owner would still be
// looking at something that "looks like a resume" (F-E-20's lesson: the more
// real that image looks, the more dangerous it is).
const AdminDraftRowSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(), for_job: z.string(),
  updated_at: z.string(),
  // expires_at —— the 1-day TTL's end; the "N hours left" chip reads it.
  expires_at: z.string(),
  // based_on_master_name —— the master this draft started from; absent = none.
  based_on_master_name: z.string().optional().default(''),
  resume_content: ResumeContentSchema,
  status: z.enum(['reviewing', 'draft', 'sent']).optional(),
  diff_text: z.string().optional(),
});
export type AdminDraftRow = z.infer<typeof AdminDraftRowSchema>;

// draftsPage —— reload() after a create, a discard or a commit: a draft committed elsewhere that
// still shows reads as "it failed", and the owner clicks again (F-E-9).
export const draftsPage = createPagedStore({ name: 'drafts', path: '/drafts/', item: AdminDraftRowSchema });

export function draftPillTone(status: DraftStatus | undefined): string {
  const map: Record<DraftStatus, string> = {
    reviewing: 'is-accent',
    draft: '',
    sent: 'is-violet',
  };
  return map[status ?? 'draft'];
}

export type DraftActionKind = 'reviewing' | 'draft' | 'sent';

export function draftActionKind(status?: DraftStatus): DraftActionKind {
  return status ?? 'draft';
}

// hoursLeft —— whole hours until expires_at, never below 0 (the chip's number).
export function hoursLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 3_600_000));
}
