// proxy.ts —— what a compressing proxy in front of a real deployment needs from an event stream.
//
// Coolify puts Traefik's compress middleware on every service it deploys (sijie.xyz, measured
// 2026-10-02). Traefik holds a response until it has about 1KB, to decide whether to compress it;
// an event stream's frames are a few dozen bytes, so a whole 20s stream arrived at once, at its
// end. A stream that opens with at least that much gets past the decision, and every later frame
// flows. Locally nothing sits in between, so the first chunk a page reads is the opening itself.

import type { Page } from '@playwright/test';

// COMPRESSOR_DECIDES_AT —— Traefik's minResponseBodyBytes default (Caddy's encode default is 512).
export const COMPRESSOR_DECIDES_AT = 1024;

// openingBytes —— the size of the first chunk the page reads from a stream (POST, the page's own
// credentials), then the stream is closed.
export async function openingBytes(page: Page, path: string): Promise<number> {
  return page.evaluate(async (url) => {
    const stop = new AbortController();
    const res = await fetch(url, { method: 'POST', credentials: 'include', signal: stop.signal });
    const body = res.body;
    if (body === null) return 0;
    const first = await body.getReader().read();
    stop.abort();
    return first.value?.byteLength ?? 0;
  }, path);
}
