// use-admin-session —— probes whether the current state is signed in. GET
// /api/admin/me; a 401 redirects to /login. A placeholder shows while loading.
//
// zustand refactor: sessionStore is the app-wide /me cache. The BYOAI / AI
// provider / admin session hooks all read from it, avoiding each panel fetching its own copy.

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { adminAPI, MeViewSchema, type MeView } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

// AdminSession —— the legacy shape: an alias for a subset of sessionStore's
// full fields (MeView). Old callers (AdminSidebar / PageSection / etc.) still read by these 4 fields.
export interface AdminSession {
  owner_id: string;
  email: string;
  handle: string;
  full_name: string;
  public_url: string;
  // pendingEmail —— an email change is waiting on confirmation. The fact
  // lives in the database (owners.pending_email); this is just a relay: the
  // owner closes the tab and comes back, and that state is still there,
  // while a component's useState would have been gone long ago.
  pendingEmail: string;
}

// AdminSessionState —— `unreachable` and `unauthed` must be two separate states (F-N-2).
//
// They tell the owner exactly opposite things: 401 = go sign in; 5xx /
// network down = the server isn't there, and signing in wouldn't help
// either. Both used to be `unauthed`, so a backend outage rendered as an
// empty sign-in form — the owner would think their password was wrong and
// keep retyping it. **"You're not signed in" is a claim about the world, and it can be false.**
export type AdminSessionState =
  | { kind: 'loading' }
  | { kind: 'unauthed' }
  | { kind: 'unreachable' }
  | { kind: 'ready'; session: AdminSession };

export const sessionStore = createResourceStore<MeView>({
  name: 'admin-session',
  fetcher: () => adminAPI.get('/me', MeViewSchema),
});

export function useAdminSession(): AdminSessionState {
  const router = useRouter();
  const r = useResource(sessionStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  // Only redirects to sign-in when **actually** not signed in. Redirecting when the server is unreachable would give advice that doesn't help.
  useEffect(() => {
    if (r.status === 'error' && isUnauthed(r.errorStatus)) router.push('/login');
  }, [r.status, r.errorStatus, router]);
  return adminSessionFromResource(r.status, r.errorStatus, r.data);
}

// isUnauthed —— only 401 / 403 mean "you're not signed in". Everything else
// (5xx, network down → errorStatus is null) means "can't reach the server".
function isUnauthed(errorStatus: number | null): boolean {
  return errorStatus === 401 || errorStatus === 403;
}

function adminSessionFromResource(
  status: string, errorStatus: number | null, data: MeView | undefined,
): AdminSessionState {
  if (status === 'error') {
    return isUnauthed(errorStatus) ? { kind: 'unauthed' } : { kind: 'unreachable' };
  }
  if (status === 'ready' && data) {
    return {
      kind: 'ready',
      session: {
        owner_id: data.owner.owner_id, email: data.owner.email,
        handle: data.owner.handle, full_name: data.owner.full_name,
        public_url: data.owner.public_url,
        pendingEmail: data.owner.pending_email ?? '',
      },
    };
  }
  return { kind: 'loading' };
}
