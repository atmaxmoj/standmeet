// use-action —— the default wrap-up for running an "owner-triggered mutation": success →
// success toast (optional), failure → reportError (401 redirects to login / everything else is
// an error toast). Replaces the `const ok = await x(); ok && toast.success(...)` idiom that was
// everywhere — that idiom only gave feedback on success and stayed silent on failure. Mutations
// now **throw** (no longer swallowed into false), and this is the one place that catches them.
//
//   const run = useAction();
//   run(() => hook.createCode(input), { success: 'Code created' });
//
// For non-default handling (rolling back optimistic state, inline-in-place, conflict
// highlighting, redirecting elsewhere) — don't use run, do your own try/catch at the call site.

'use client';

import { useCallback } from 'react';

import { useToast } from '@/lib/ui/toast';
import { useReportError } from '@/lib/ui/use-report-error';

interface ActionOpts {
  success?: string;
}

export function useAction(): (fn: () => Promise<unknown>, opts?: ActionOpts) => Promise<void> {
  const toast = useToast();
  const report = useReportError();
  return useCallback(async (fn: () => Promise<unknown>, opts?: ActionOpts) => {
    try {
      await fn();
      opts?.success !== undefined && toast.success(opts.success);
    } catch (e) {
      report(e);
    }
  }, [toast, report]);
}
