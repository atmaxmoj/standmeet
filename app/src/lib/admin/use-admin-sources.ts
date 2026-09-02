// use-admin-sources —— fetch hook for /admin/job-sources (#51).
// The admin session cookie is validated at the AdminShell layer, so this
// just fetches + parses directly. Registering a source goes through MCP
// jobs.register_source; admin only reads the list.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

const AdminSourceRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  last_fetched_at: z.string().nullable().optional(),
  // When it was last **attempted** and how it turned out (empty string =
  // succeeded). Without these two fields the UI can't tell "always fails"
  // apart from "never attempted" (F-E-18).
  last_attempted_at: z.string().nullable().optional(),
  last_error: z.string().optional(),
  created_at: z.string(),
});
export type AdminSourceRow = z.infer<typeof AdminSourceRowSchema>;

const ENDPOINT = '/api/admin/job-sources/';

interface State {
  rows: AdminSourceRow[];
  loading: boolean;
  error: string | null;
}

export function useAdminSources(): State {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  useEffect(() => { void load(setState); }, []);
  return state;
}

export type SourcesBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickSourcesBodyState —— used by the component, avoids an if-ladder in the .tsx that would trip no-if/cyclo.
export function pickSourcesBodyState(
  count: number, loading: boolean, error: string | null,
): SourcesBodyState {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include' });
    if (!res.ok) throw new Error(`list sources: ${res.status}`);
    const rows = await safeJson(res, z.array(AdminSourceRowSchema));
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load sources failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
