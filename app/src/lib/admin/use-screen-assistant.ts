// use-screen-assistant —— the live cue feed the desktop app pushes over MCP (assistant.push). Holds
// one Server-Sent Events connection to GET /api/admin/screen-assistant/stream, kept alive by the
// server's pings. Each frame is the whole current card set, so this just mirrors it: whatever the last
// frame said is what's on screen, and an empty set (the interview ended) clears the view. No cursor,
// no accumulation — the fact of what to show lives on the server.

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

const EventsSchema = z.array(EventSchema);

// RETRY_MS —— EventSource does not reconnect itself after a non-2xx (a 401 when the access token
// lapsed), so on any error we refresh and reopen after this long.
const RETRY_MS = 1_000;

function parseEvents(data: string): AssistantEvent[] | null {
  try {
    const parsed = EventsSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useScreenAssistant(): { events: AssistantEvent[]; error: string | null } {
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const onMessage = (ev: MessageEvent<string>) => {
      const next = parseEvents(ev.data);
      if (!next) return;
      setError(null);
      setEvents(next); // the frame is the whole current set — mirror it (empty = the interview ended)
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
      es = new EventSource('/api/admin/screen-assistant/stream', { withCredentials: true });
      es.onmessage = onMessage;
      es.onerror = onError;
    }
    open();
    return () => { stopped = true; es?.close(); clearTimeout(retry); };
  }, []);
  return { events, error };
}
