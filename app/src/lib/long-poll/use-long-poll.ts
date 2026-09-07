// use-long-poll — mount a generic long-poll (long-poll.worker) for the lifetime of a component and
// tear it down with one worker.terminate() on unmount, which kills the held request too. The worker
// is business-agnostic infra; the caller says which cursor URL to watch and what to do when it moves.

'use client';

import { useEffect, useRef } from 'react';

export interface LongPollOptions {
  // The cursor endpoint, e.g. '/api/admin/microsites/wait'. Server answers when the cursor advances.
  url: string;
  // The query param carrying the current cursor (default 'since') and the response field that
  // reports the server's cursor (default 'version').
  cursorParam?: string;
  cursorField?: string;
}

// useLongPoll — calls onAdvance(cursor) whenever the server's cursor moves past what the worker last
// saw. The worker (and its held connection) is terminated on unmount, so navigating away is instant.
export function useLongPoll(opts: LongPollOptions, onAdvance: (cursor: number) => void): void {
  const cb = useRef(onAdvance);
  cb.current = onAdvance;
  const { url, cursorParam = 'since', cursorField = 'version' } = opts;
  useEffect(() => {
    const worker = new Worker(new URL('./long-poll.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<number>): void => { cb.current(e.data); };
    worker.postMessage({ url, cursorParam, cursorField, start: 0 });
    return () => { worker.terminate(); };
  }, [url, cursorParam, cursorField]);
}
