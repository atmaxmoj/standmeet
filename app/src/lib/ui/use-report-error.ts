// use-report-error —— the **default** display strategy for surfacing an error to the UI, for a
// hook / component to call in its catch block:
//   const report = useReportError();
//   try { await hook.doThing(); } catch (e) { report(e); }
//
// Routing: session expired (401) → redirect to login (a toast is pointless — re-authentication
// is required); everything else → error toast (the backend envelope's human-readable message).
// Cases that need inline-in-place / conflict highlighting / optimistic-state rollback / other
// custom handling decide that themselves in their own catch block, and don't go through this default.

'use client';

import { useCallback } from 'react';

import { APIError } from '@/lib/api/api-error';
import { useToast } from '@/lib/ui/toast';

const LOGIN_PATH = '/login';

export function useReportError(): (err: unknown) => void {
  const toast = useToast();
  return useCallback((err: unknown) => {
    if (err instanceof APIError && err.status === 401) {
      window.location.assign(LOGIN_PATH); // session expired → re-authenticate, not a toast the user can only stare at
      return;
    }
    toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
  }, [toast]);
}
