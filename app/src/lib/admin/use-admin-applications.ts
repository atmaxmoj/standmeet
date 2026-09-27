// use-admin-applications —— /admin/applications state: one page at a time, searched on the server
// (docs/design/paging.md).

import { z } from 'zod';

import { ResumeContentSchema } from '@/lib/admin/draft-detail';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';

// resume_content —— this is what the detail card's snapshot block renders
// (F-E-23: that block used to be just a title and blank space, and nowhere
// else in the product could answer "what did I actually send").
const AdminApplicationRowSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(), status: z.string(),
  submitted_at: z.string(), created_at: z.string(),
  resume_content: ResumeContentSchema,
});
export type AdminApplicationRow = z.infer<typeof AdminApplicationRowSchema>;

// applicationsPage —— newest first; `q` (company / role / status) narrows on the server. The
// page's total is every application, search or not: the header counts what was committed.
const applicationsPage = createPagedStore({
  name: 'applications', path: '/applications/', item: AdminApplicationRowSchema, params: { q: '' },
});

export interface ApplicationsHook {
  rows: readonly AdminApplicationRow[];
  total: number | null;
  loading: boolean;
  error: string | null;
  query: string;
  setQuery: (q: string) => void;
  page: PagedState<AdminApplicationRow>;
}

export function useAdminApplications(): ApplicationsHook {
  const page = usePaged(applicationsPage);
  return {
    rows: page.items,
    total: page.total,
    loading: page.status === 'idle' || page.status === 'loading',
    error: page.status === 'error' ? page.error ?? 'load failed' : null,
    query: page.params.q ?? '',
    setQuery: (q) => page.setParams({ q }),
    page,
  };
}
