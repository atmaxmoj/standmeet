// output-retrieval-scale.spec.ts — retrieval over the output corpus must also cover the
// **whole corpus**, not have the backend load the newest 50 rows and grep in memory.
// wiki's twin: the retriever's output search/read + cited-reverse-lookup still all hit
// the newest-50 cap today (matchOutputs / findOutputByPath / outputCitedRefs are all
// confined to that in-memory window). Seed an output needle with a unique keyword
// **first**, then pour in 52 filler outputs to push it out of the newest 50; the visitor
// asks about the needle -> mock does search->read->cite.
//
// Today (50-cap): search can't find the needle among the 50 in-memory outputs -> never
// cites it -> **red**. Once output retrieval moves to full DB-side coverage: green. Runs
// the complete agent loop.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'outscale@example.com', password: 'correct-horse-battery-staple',
  handle: 'outscale', fullName: 'Output Scale Owner',
};
const CODE = 'OUTSCALE-1';

const NEEDLE_KEYWORD = 'quasarvix';
const NEEDLE_PATH = 'quasar-output';
const FILLER_COUNT = 52;

test.describe('output retrieval covers the whole corpus, not the newest-50 window', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // The role is scoped only to output://**: wiki (the intermediate promote artifact)
    // gets filtered out by ACL, leaving only output hits.
    const role = await createRole(request, csrf, {
      name: 'output-only', description: 'output://** only', corpus_uris: ['output://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'outscale', assumed_role_id: role.id,
    });
    await seedNeedleThenFillers(request, csrf);
    await request.dispose();
  });

  test('a needle output beyond the newest-50 is still found + cited by the agent',
    async ({ browser, playwright }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      let conversationID = '';
      page.on('response', async (res) => {
        if (res.url().endsWith('/api/v1/sessions') && res.status() === 200) {
          try {
            const body = await res.json() as { conversation_id?: string };
            if (body.conversation_id) conversationID = body.conversation_id;
          } catch { /* noop */ }
        }
      });

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const turnDone = page.waitForResponse((res) =>
        res.url().includes('/agent/turn') && res.status() === 200, { timeout: 20_000 });
      // Assertion is citation of the deep output → script corpus_read of its path.
      // corpus_read resolves by path fresh per genre (no in-memory newest-N window),
      // so a needle beyond the newest-50 is still read + cited across the full corpus.
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: NEEDLE_PATH },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about ${NEEDLE_KEYWORD}${readTag}`);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await (await turnDone).finished();

      expect(conversationID).not.toBe('');
      const reqCtx = await playwright.request.newContext();
      const { csrf } = await loginAPI(reqCtx, OWNER.email, OWNER.password);
      const cited = await fetchCitedOutputPaths(reqCtx, csrf, conversationID);
      expect(cited).toContain(NEEDLE_PATH);
      await reqCtx.dispose();
      await ctx.close();
    });
});

async function seedNeedleThenFillers(request: APIRequestContext, csrf: string): Promise<void> {
  const token = await createAPIToken(request, csrf, 'outscale-seed');
  const sid = await initMCP(request, token);
  await seedOutput(request, token, sid, 'Quasar Output',
    `The ${NEEDLE_KEYWORD} protocol is a fictional pipeline I shipped.`);
  for (let i = 0; i < FILLER_COUNT; i += 1) {
    await seedOutput(request, token, sid, `Filler Output ${i}`,
      `Filler output number ${i} about unrelated everyday work.`);
  }
}

// seedOutput — corpus.create(raw) -> promote to wiki -> promote to output. Returns the
// new output's id.
async function seedOutput(
  request: APIRequestContext, token: string, sid: string, title: string, body: string,
): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, token, sid, 'corpus.create', { genre: 'raw', body, source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote', { genre: 'raw', id: raw.id, title, tags: [] },
  );
  const out = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote', { genre: 'wiki', id: wiki.id, title, tags: [] },
  );
  return out.id;
}

interface CitedRefView { id: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_output_ids: string[] }>;
  output_refs: CitedRefView[];
}

async function fetchCitedOutputPaths(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const citedIDs = new Set(assistant?.cited_output_ids ?? []);
  return body.output_refs.filter((r) => citedIDs.has(r.id)).map((r) => r.path);
}
