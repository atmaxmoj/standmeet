// posts-lifecycle.ts —— timeline reads as parsed items, for the specs that check order, "edited"
// and paging (posts-lifecycle / posts-paging). posts.ts holds the raw-text reader the matrix uses.

import type { APIRequestContext } from '@playwright/test';

import type { Page, PublicPost } from '@/fixtures/posts';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// timelinePage —— one GET /api/v1/posts page; no token = anonymous.
export async function timelinePage(
  request: APIRequestContext, opts: { token?: string; cursor?: string; limit?: number } = {},
): Promise<Page<PublicPost>> {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.cursor) q.set('cursor', opts.cursor);
  const res = await request.get(`${BACKEND}/api/v1/posts?${q.toString()}`,
    { headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {} });
  if (res.status() !== 200) throw new Error(`timeline ${res.status()}: ${await res.text()}`);
  return await res.json() as Page<PublicPost>;
}

// timelineItems —— every page, in the order the server gave them.
export async function timelineItems(request: APIRequestContext, token = ''): Promise<PublicPost[]> {
  const out: PublicPost[] = [];
  let cursor = '';
  for (let i = 0; i < 100; i++) {
    const page = await timelinePage(request, { token, cursor });
    out.push(...page.items);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}
