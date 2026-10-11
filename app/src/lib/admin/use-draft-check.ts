// use-draft-check —— the composer's send dialog (job-loop roadmap 5.1.d): what the draft changes
// against the owner's master, read when the dialog opens, and which of those the owner has ticked.
// Send waits until every finding is ticked; the commit carries them as `accept`, by key.

'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const FindingSchema = z.object({
  key: z.string(), kind: z.string(), master: z.string(), draft: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

const CheckSchema = z.object({ coverage: z.string(), findings: z.array(FindingSchema) });

export interface DraftCheckHook {
  findings: readonly Finding[];
  loaded: boolean;
  accepted: ReadonlySet<string>;
  toggle: (key: string) => void;
  // ready —— loaded, and every finding ticked.
  ready: boolean;
}

export function useDraftCheck(draftId: string): DraftCheckHook {
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    // A failed read leaves no findings listed; the commit itself still refuses an unaccepted one
    // and says which.
    void adminAPI.get(`/drafts/${draftId}/check`, CheckSchema)
      .then((c) => setFindings(c.findings), () => setFindings([]))
      .finally(() => setLoaded(true));
  }, [draftId]);
  const toggle = (key: string) => setAccepted((prev) => toggled(prev, key));
  return {
    findings, loaded, accepted, toggle,
    ready: loaded && findings.every((f) => accepted.has(f.key)),
  };
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
