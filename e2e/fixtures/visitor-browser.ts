// visitor-browser.ts —— a REAL browser visitor, sharing nothing with the owner. Unlike
// visitAsStranger (a raw request context that GETs one API route), this opens the real PAGE, so the
// page's own fetches run — the SSR self-fetch AND the browser's beacon — exactly as they do for a
// person. That is the only way to see the app counting (or not counting) itself.
//
// page.goto + the settle wait live HERE, not in a spec: a spec drives the owner UI from a known
// entry point, but a visitor opening a public URL is a navigation, and that primitive belongs to a
// fixture (the e2e spec lint forbids it in test bodies, on purpose).

import { expect } from '@playwright/test';
import type { Playwright } from '@playwright/test';

// baseURL —— the app origin THIS checkout publishes. The e2e harness exports BASE_URL from
// DEV_PORT_APP (per-checkout), so there is no default port to hardcode: a missing BASE_URL is a
// harness wiring bug, not something to paper over with a literal that names the wrong stack.
function baseURL(): string {
  const b = process.env['BASE_URL'];
  if (b === undefined || b === '') {
    throw new Error('BASE_URL is not set — the e2e harness exports it from DEV_PORT_APP');
  }
  return b;
}

// VisitorBrowser —— read(path) opens the real page and lets it settle (SSR arrives, then the client
// hydrates + re-fetches + beacons); dispose() closes everything.
export interface VisitorBrowser {
  read(path: string): Promise<void>;
  dispose(): Promise<void>;
}

// openVisitorBrowser —— one real browser context = one session. `geo` carries the CDN edge headers a
// self-hosted instance sits behind (cf-ipcountry/city…), so country/city flow end to end and the
// real request is told apart from the app's own server fetch.
export async function openVisitorBrowser(
  pw: Playwright, geo: Record<string, string> = {},
): Promise<VisitorBrowser> {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({
    baseURL: baseURL(),
    extraHTTPHeaders: geo,
  });
  return {
    read: async (path: string) => {
      const p = await ctx.newPage();
      const res = await p.goto(path);
      expect(res?.status(), `the reader page must load: ${path}`).toBe(200);
      await p.waitForLoadState('networkidle');
      await p.close();
    },
    dispose: async () => {
      await ctx.close();
      await browser.close();
    },
  };
}
