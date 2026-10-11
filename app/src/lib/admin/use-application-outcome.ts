// use-application-outcome —— the detail modal's outcome (roadmap 1.3.d): the current outcome, its
// journal (one row per change, oldest first), and setting a new one through the same use case the
// owner's MCP runs. The list row is patched with the stored row, so it agrees after a set.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { AdminApplicationRowSchema, type AdminApplicationRow } from '@/lib/admin/use-admin-applications';

const OutcomeRowSchema = z.object({
  created_at: z.string(), from_outcome: z.string(), to_outcome: z.string(), note: z.string(),
});
export type OutcomeRow = z.infer<typeof OutcomeRowSchema>;

// QuestionSchema —— one thing the recruiter asked and the agent's answer (roadmap 2.1.c); grounded
// false = a gap the corpus could not answer.
const QuestionSchema = z.object({
  conversation_id: z.string(), asked_at: z.string(), question: z.string(), answer: z.string(),
  grounded: z.boolean(), topics: z.array(z.string()),
});
export type TheirQuestion = z.infer<typeof QuestionSchema>;

const DetailSchema = AdminApplicationRowSchema.extend({
  outcomes: z.array(OutcomeRowSchema),
  questions: z.array(QuestionSchema).default([]),
});

export interface ApplicationOutcome {
  outcome: string;
  journal: readonly OutcomeRow[];
  questions: readonly TheirQuestion[];
  busy: boolean;
  error: string;
  set: (outcome: string) => void;
}

export function useApplicationOutcome(
  id: string, initial: string, onSaved: (row: AdminApplicationRow) => void,
): ApplicationOutcome {
  const [outcome, setOutcome] = useState(initial);
  const [journal, setJournal] = useState<readonly OutcomeRow[]>([]);
  const [questions, setQuestions] = useState<readonly TheirQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => adminAPI.get(`/applications/${id}`, DetailSchema).then((d) => {
    setOutcome(d.outcome);
    setJournal(d.outcomes);
    setQuestions(d.questions);
  }), [id]);
  useEffect(() => { load().catch((e: unknown) => setError(messageOf(e))); }, [load]);
  const set = (next: string) => {
    setBusy(true);
    setError('');
    adminAPI.post(`/applications/${id}/outcome`, { outcome: next, note: '' }, AdminApplicationRowSchema)
      .then((row) => { onSaved(row); return load(); })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  return { outcome, journal, questions, busy, error, set };
}

// questionMeta —— a question row's marks: whether it is a gap, and the line under its answer (the
// gap sentence, then the topics the answer touched).
export function questionMeta(q: TheirQuestion, gapText: string): { gap: 'true' | 'false'; note: string } {
  const parts = [q.grounded ? '' : gapText, ...q.topics].filter((p) => p !== '');
  return { gap: q.grounded ? 'false' : 'true', note: parts.join(' · ') };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
