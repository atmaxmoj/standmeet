// use-screen-assistant —— the live feed the desktop cue app pushes over MCP (assistant.push).
// Polls GET /screen-assistant/events?since=<last seq>. A cue streams as growing text under one
// id, so the feed keeps one entry per id with the latest text, in first-seen order.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const EventSchema = z.object({
  seq: z.number(),
  id: z.string(),
  kind: z.enum(['heard', 'cue']),
  text: z.string(),
  at: z.string(),
});
export type AssistantEvent = z.infer<typeof EventSchema>;

// POLL_MS —— a streamed cue pushes every ~300 ms; one second keeps the card visibly growing.
const POLL_MS = 1_000;

export function mergeEvents(
  prev: readonly AssistantEvent[], next: readonly AssistantEvent[],
): AssistantEvent[] {
  const out = [...prev];
  for (const e of next) {
    const i = out.findIndex((p) => p.id === e.id && p.kind === e.kind);
    if (i >= 0) out[i] = e;
    else out.push(e);
  }
  return out;
}

export function useScreenAssistant(): { events: AssistantEvent[]; error: string | null } {
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let since = 0;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await adminAPI.get(`/screen-assistant/events?since=${since}`, z.array(EventSchema));
        if (stopped) return;
        setError(null);
        if (next.length > 0) {
          since = next[next.length - 1]!.seq;
          setEvents((prev) => mergeEvents(prev, next));
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return { events, error };
}
