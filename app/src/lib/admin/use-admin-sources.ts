// use-admin-sources —— data + actions for /admin/job-sources (#51).
//
// Reading was always here; **registering and removing a source used to be MCP-only**
// (jobs.register_source / jobs.unregister_source), so the panel could only show a list
// and tell the owner to go to Claude. The owner, touring the live instance: "I only see
// one, not 17 — and no way to add another." The backend grew POST/DELETE /job-sources
// (calling the same usecases the MCP tools do); this hook exposes them so the panel has a
// real register form + a remove button. The backend stays the single validation
// authority — a bad (kind, config) comes back as a 400 with an owner-readable message
// ("greenhouse config: board is required"), which the form shows verbatim.

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
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

// ADAPTER_KINDS —— the source kinds the backend registry can fetch, with a config
// example the form prefills. This is a **hint**, not a second validator: the backend's
// ValidateKindConfig stays the one authority (duplicating the config rules client-side
// is exactly the drift [[vocabulary-must-not-diverge]] warns about). An empty config
// means the kind needs none (public feeds).
export const ADAPTER_KINDS: readonly { kind: string; config: string }[] = [
  { kind: 'greenhouse', config: '{"company":"airbnb"}' },
  { kind: 'lever', config: '{"company":"netflix"}' },
  { kind: 'ashby', config: '{"company":"ramp"}' },
  { kind: 'smartrecruiters', config: '{"company":"square"}' },
  { kind: 'workable', config: '{"company":"acme","api_token":"…"}' },
  { kind: 'bamboohr', config: '{"company":"acme"}' },
  { kind: 'recruitee', config: '{"company":"acme"}' },
  { kind: 'workday', config: '{"tenant":"acme","wd":"wd5","site":"External"}' },
  { kind: 'jba', config: '{"ats":"greenhouse","location":"remote"}' },
  { kind: 'jobposting_jsonld', config: '{"sitemap":"https://example.com/sitemap.xml"}' },
  { kind: 'remoteok', config: '' },
  { kind: 'hn_hiring', config: '' },
  { kind: 'wwr', config: '' },
  { kind: 'jobicy', config: '' },
  { kind: 'remotive', config: '' },
  { kind: 'himalayas', config: '' },
  { kind: 'working_nomads', config: '' },
];

interface State {
  rows: AdminSourceRow[];
  loading: boolean;
  error: string | null;
}

// AdminSourcesHook —— the list plus the two writes the panel needs.
export interface AdminSourcesHook extends State {
  reload: () => Promise<void>;
  registerSource: (kind: string, label: string, configText: string) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
}

export function useAdminSources(): AdminSourcesHook {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  const reload = useCallback(() => load(setState), []);
  useEffect(() => { void reload(); }, [reload]);
  const registerSource = useCallback(async (kind: string, label: string, configText: string) => {
    await adminAPI.post('/job-sources/', {
      kind, label, config: parseConfig(configText),
    }, AdminSourceRowSchema);
    await reload();
  }, [reload]);
  const removeSource = useCallback(async (id: string) => {
    await adminAPI.deleteVoid(`/job-sources/${id}`);
    await reload();
  }, [reload]);
  return { ...state, reload, registerSource, removeSource };
}

// parseConfig —— turn the form's config text into the JSON object the backend expects.
// Empty → {} (the public-feed kinds). Non-JSON → a friendly throw **before** the request,
// so the owner isn't left decoding a 400 for a mistake we can name here.
function parseConfig(text: string): unknown {
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('config must be valid JSON, e.g. {"company":"airbnb"}');
  }
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
