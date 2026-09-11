// mcp-obsidian-sync.spec.ts —— the owner MCP can sync a vault, not just the admin HTTP multipart.
//
// Parity: the owner MCP is the owner's admin surface — whatever the admin HTTP has, the MCP has.
// The vault sync (obsidian.import) was the one owner op that never became a dispatcher op — it was a
// bespoke multipart admin handler, so it never auto-wired to MCP. The multipart is only ONE
// transport; the operation (feed a batch of files to the SyncIngester) is facade-agnostic, so it
// belongs on MCP too, carried as a JSON `files` array. Without it the owner cannot sync from their
// AI client — the whole point of the owner MCP.
//
// Real end-to-end: this drives the actual MCP surface (the same bridge Claude Desktop / Cursor use)
// and then RETRIEVES the synced content back through MCP corpus.search — proving the file survived
// the full obsidian.import → SyncIngester → corpus store → search path. Nothing is injected: the
// marker asserted on is the body the sync was handed, read back from the database, not fed to the
// assertion. A raw note is used because raw materializes unconditionally (wiki is publish-gated),
// keeping the test about the sync path rather than the publish rules.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'mcp-sync@example.com', password: 'correct-horse-battery-staple',
  handle: 'mcp-sync', fullName: 'MCP Sync Owner',
};

interface MCPSession { request: APIRequestContext; token: string; sid: string }
interface SyncResult { created: number; updated: number; skipped: number; deleted: number }
let s: MCPSession;

test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'mcp-sync-token');
  s = { request, token, sid: await initMCP(request, token) };
});

test.afterAll(async () => { await s.request.dispose(); });

test.describe('owner MCP syncs a vault (parity with the admin multipart)', () => {
  test('obsidian.import via MCP lands a note in the corpus, retrievable by its content', async () => {
    // A one-word marker so the lexical search tokenizes it cleanly (no punctuation/CJK boundary).
    const marker = 'mcpsyncprobeword';
    const res = await callTool<SyncResult>(s.request, s.token, s.sid, 'obsidian.import', {
      files: [
        {
          path: 'raw/mcp-sync-probe.md',
          content: `A raw note synced through the owner MCP, carrying ${marker} as its distinctive term.`,
        },
      ],
    });
    expect(res.created, 'the synced file created a note').toBeGreaterThanOrEqual(1);

    // The proof is retrieval, not the return count: search the corpus for the marker the sync was
    // handed. A hit means the content went all the way through obsidian.import → SyncIngester →
    // store → the search index the visitor's AI grounds on.
    const found = await callTool<{ id: string }[]>(s.request, s.token, s.sid, 'corpus.search', {
      genre: 'raw', query: marker,
    });
    expect(found.length, 'the synced note is retrievable from the corpus').toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(found), 'the retrieved note carries exactly the content that was synced')
      .toContain(marker);
  });
});
