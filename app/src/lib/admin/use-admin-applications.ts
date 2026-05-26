// use-admin-applications —— /admin/applications 的 fetch hook。

import { useEffect, useState } from 'react';

export interface AdminApplicationRow {
  id: string;
  company: string;
  role: string;
  status: string;
  submitted_at: string;
  created_at: string;
}

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
    const rows = await res.json() as AdminApplicationRow[];
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load applications failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
