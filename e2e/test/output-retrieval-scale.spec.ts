// output-retrieval-scale.spec.ts —— output 语料的检索也必须覆盖**全量**,不是后端先
// load 最新 50 条再内存 grep。wiki 的孪生:retriever 的 output search/read + cited 反查
// 现在还都吃 newest-50 cap(matchOutputs / findOutputByPath / outputCitedRefs 全在内存
// 窗口里)。把一个带唯一关键词的 output needle **最先**种下,再灌 52 条 filler output 把
// 它推出最新 50,visitor 问 needle → mock search→read→cite。
//
// 现在(50-cap):search 在内存 50 条 output 里搜不到 needle → 不 cite → **红**。
// output 检索改 DB 端全量后:绿。走完整 agent loop。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

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
    // role 只 scope output://**:wiki(promote 的中间产物)被 ACL 滤掉,只剩 output 命中。
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
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about ${NEEDLE_KEYWORD}`);
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

// seedOutput —— raw_dump → promote_to_wiki → promote_wiki_to_output。返 output_id。
async function seedOutput(
  request: APIRequestContext, token: string, sid: string, title: string, body: string,
): Promise<string> {
  const raw = await callTool<{ raw_id: string }>(
    request, token, sid, 'raw_dump', { body, source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ wiki_id: string }>(
    request, token, sid, 'promote_to_wiki', { raw_id: raw.raw_id, title, tags: [] },
  );
  const out = await callTool<{ output_id: string }>(
    request, token, sid, 'promote_wiki_to_output', { wiki_id: wiki.wiki_id, title, tags: [] },
  );
  return out.output_id;
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
