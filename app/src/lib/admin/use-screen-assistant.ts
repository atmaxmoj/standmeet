// use-screen-assistant —— the live feed the desktop cue app pushes over MCP (assistant.push). Holds
// one Server-Sent Events connection to GET /api/admin/screen-assistant/stream?since=<last seq>, kept
// alive by the server's pings, and is pushed each new event. A cue streams as growing text under one
// id, so the feed keeps one entry per id with the latest text, in first-seen order.

import { useEffect, useState } from 'react';

import { z } from 'zod';

const EventSchema = z.object({
  seq: z.number(),
  id: z.string(),
  kind: z.enum(['heard', 'said', 'cue']),
  text: z.string(),
  at: z.string(),
});
export type AssistantEvent = z.infer<typeof EventSchema>;

// RETRY_MS —— EventSource does not reconnect itself after a non-2xx (a 401 when the access token
// lapsed), so on any error we refresh and reopen after this long.
const RETRY_MS = 1_000;

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

function parseEvent(data: string): AssistantEvent | null {
  try {
    const parsed = EventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useScreenAssistant(): { events: AssistantEvent[]; error: string | null } {
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let since = 0;
    let stopped = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const onMessage = (ev: MessageEvent<string>) => {
      const e = parseEvent(ev.data);
      if (!e) return;
      since = e.seq;
      setError(null);
      setEvents((prev) => mergeEvents(prev, [e]));
    };
    const onError = () => {
      if (stopped) return;
      setError('reconnecting'); // signed out: the stream 401s and this stays, so /cue offers sign-in
      es?.close();
      // the access token may have lapsed; refresh (silent, like adminAPI's 401 path), then reopen.
      void fetch('/api/admin/refresh', { method: 'POST', credentials: 'include' }).catch(() => {});
      retry = setTimeout(() => { if (!stopped) open(); }, RETRY_MS);
    };
    function open(): void {
      es = new EventSource(`/api/admin/screen-assistant/stream?since=${since}`, { withCredentials: true });
      es.onmessage = onMessage;
      es.onerror = onError;
    }
    open();
    return () => { stopped = true; es?.close(); clearTimeout(retry); };
  }, []);
  return { events, error };
}
