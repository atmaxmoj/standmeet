// proxy.ts —— the proxy in front of a real deployment, as a page sees it.
//
// Cloudflare (in front of sijie.xyz, measured 2026-10-02) holds a GET event stream until the
// response ends, and passes a POST stream through as it comes (cloudflare/cloudflared#1449).
// Locally nothing sits in between, so a stream that only works unbuffered passed every spec.

import type { Page } from '@playwright/test';

// holdGetStreams —— a GET to any `…/stream` reaches the page only once the response has ended.
export async function holdGetStreams(page: Page): Promise<void> {
  await page.route('**/stream', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ response: await route.fetch({ timeout: 60_000 }) });
  });
}
