/// <reference lib="webworker" />
// long-poll.worker.ts — a generic, business-agnostic long-poll that runs OFF the main thread.
//
// Why a worker: a held request (the server answers the instant a cursor advances, else on its idle
// timeout) sits on a connection for a long time. On the main thread that held socket can starve the
// RSC-navigation fetch, so clicking away "takes a while before it navigates". In a worker it's
// isolated, and the consumer stops EVERYTHING — the held request included — with one
// `worker.terminate()`, no AbortController threaded through the app (owner: "自己的 worker，不影响
// 别的，杀也容易").
//
// It knows no business: the main thread posts a { url, cursorParam, cursorField, start } config, the
// worker holds a GET against `<url><?|&><cursorParam>=<cursor>`, and each time the JSON response's
// <cursorField> moves past the cursor it posts the new cursor back and re-hangs. Errors back off.

interface LongPollConfig {
  url: string;
  cursorParam: string;
  cursorField: string;
  start: number;
}

const BACKOFF_MS = 2_000;

function join(url: string, param: string, cursor: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}${param}=${cursor}`;
}

function nextCursor(body: unknown, field: string, cursor: number): number {
  // Reflect.get reads the field off the parsed JSON without a type assertion (the boundary is
  // genuinely `unknown`); a non-number or a non-advance leaves the cursor where it is.
  const v: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, field) : undefined;
  return typeof v === 'number' && v > cursor ? v : cursor;
}

async function loop(cfg: LongPollConfig): Promise<void> {
  let cursor = cfg.start;
  for (;;) {
    try {
      const res = await fetch(join(cfg.url, cfg.cursorParam, cursor), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const advanced = nextCursor(await res.json(), cfg.cursorField, cursor);
      if (advanced > cursor) {
        cursor = advanced;
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- `self` in a worker is the DedicatedWorkerGlobalScope (postMessage takes one arg), but the app's DOM lib types it as Window.
        (self as DedicatedWorkerGlobalScope).postMessage(cursor);
      }
    } catch {
      await new Promise((r) => { setTimeout(r, BACKOFF_MS); });
    }
  }
}

self.onmessage = (e: MessageEvent<LongPollConfig>): void => { void loop(e.data); };
