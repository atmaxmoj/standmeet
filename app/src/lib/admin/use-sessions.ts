// use-sessions —— the owner's active login sessions for the system panel.
// GET /api/admin/sessions lists them (IP, device, when, which is current);
// DELETE /api/admin/sessions/{id} revokes one. The current session is revoked
// through the normal signOut() flow, not here, so this only ever revokes others.

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import type { ResourceStatus } from '@/lib/state/status';

const SessionSchema = z.object({
  id: z.string(),
  ip_address: z.string(),
  user_agent: z.string(),
  created_at: z.string(),
  current: z.boolean(),
});
export type SessionRow = z.infer<typeof SessionSchema>;

interface State {
  sessions: SessionRow[];
  status: ResourceStatus;
}

export function useSessions(): State & {
  reload: () => void;
  revoke: (id: string) => Promise<void>;
} {
  const [state, setState] = useState<State>({ sessions: [], status: 'loading' });
  const reload = useCallback(() => { void load(setState); }, []);
  useEffect(() => { reload(); }, [reload]);
  const revoke = useCallback((id: string) => adminAPI.deleteVoid(`/sessions/${id}`), []);
  return { ...state, reload, revoke };
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const sessions = await adminAPI.get('/sessions', z.array(SessionSchema));
    setState({ sessions, status: 'ready' });
  } catch {
    setState({ sessions: [], status: 'error' });
  }
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'], [/Version\/.*Safari/, 'Safari'],
];
const OSES: readonly (readonly [RegExp, string])[] = [
  [/Windows/, 'Windows'], [/Mac OS X|Macintosh/, 'macOS'], [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'], [/Linux/, 'Linux'],
];

function matchLabel(ua: string, pairs: readonly (readonly [RegExp, string])[], fallback: string): string {
  for (const [re, label] of pairs) {
    if (re.test(ua)) return label;
  }
  return fallback;
}

// deviceLabel —— a friendly "Chrome on macOS" from the raw user agent. A best-effort
// heuristic, no dependency; an unrecognized agent falls back gracefully.
export function deviceLabel(ua: string): string {
  if (ua === '') return 'Unknown device';
  const browser = matchLabel(ua, BROWSERS, 'Browser');
  const os = matchLabel(ua, OSES, '');
  return os === '' ? browser : `${browser} on ${os}`;
}
