// use-admin-applications —— fetch hook for /admin/applications.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { ResumeContentSchema } from '@/lib/admin/draft-detail';
import { safeJson } from '@/lib/api/typed-json';

// resume_content —— this is what the detail card's snapshot block renders
// (F-E-23: that block used to be just a title and blank space, and nowhere
// else in the product could answer "what did I actually send").
const AdminApplicationRowSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(), status: z.string(),
  submitted_at: z.string(), created_at: z.string(),
  resume_content: ResumeContentSchema,
});
export type AdminApplicationRow = z.infer<typeof AdminApplicationRowSchema>;

const ENDPOINT = '/api/admin/applications/';

interface State {
  rows: AdminApplicationRow[];
  loading: boolean;
  error: string | null;
}

export function useAdminApplications(): State {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  useEffect(() => { void load(setState); }, []);
  return state;
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include' });
    if (!res.ok) throw new Error(`list applications: ${res.status}`);
    const rows = await safeJson(res, z.array(AdminApplicationRowSchema));
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load applications failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
