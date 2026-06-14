// wiki-retrieval-scale.spec.ts —— 检索必须覆盖**全量**语料,不是「后端先 load 最新
// 50 条再在里面 grep」。
//
// 现实现 buildRetriever 一次性 ListByOwner(50)(created_at DESC)钉死候选集 → 第
// 51 条往后的语料 LLM 根本搜不到。这里把一个带唯一关键词的 needle **最先**种下,
// 再灌 52 条 filler,使 needle 落到「最新 50」之外。visitor 问 needle → mock 走默认
// corpus_search(问句)→corpus_read(首个命中)→cite。
//
// 现在(50-cap):search 在内存 50 条里搜不到 needle → 不 cite → 本测试**红**。
// retriever 改成 DB 端全量搜索后:search 命中 needle → read → cite → 绿。
//
// 走完整 agent loop(真 /agent/turn + mock 模拟 LLM 的 search→read),不打 tool 半截。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'scale@example.com', password: 'correct-horse-battery-staple',
  handle: 'scaleowner', fullName: 'Scale Owner',
};
const CODE = 'SCALE-001';

// needle —— 唯一关键词 + 树派生 path(最先种,落在最新 50 之外)。
const NEEDLE_KEYWORD = 'zephyrqx';
const NEEDLE_PATH = 'deep/zephyr-protocol';
const FILLER_COUNT = 52;

test.describe('retrieval covers the whole corpus, not the newest-50 window', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const csrf = await seedNeedleThenFillers(request);
    await createCode(request, csrf, { code: CODE, label: 'scale', purpose: 'retrieval scale' });
    await request.dispose();
  });

  test('a needle beyond the newest-50 is still found + cited by the agent',
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
      const cited = await fetchCitedRefs(reqCtx, csrf, conversationID);
      expect(cited.map((r) => r.path)).toContain(NEEDLE_PATH);
      await reqCtx.dispose();
      await ctx.close();
    });
});

// seedNeedleThenFillers —— needle 最先种(最旧),再 52 条 filler,把 needle 推出最新 50。
async function seedNeedleThenFillers(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'scale-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: `The ${NEEDLE_KEYWORD} protocol is a fictional internal handshake I designed.`,
    title: 'Zephyr Protocol', path: NEEDLE_PATH,
  });
  for (let i = 0; i < FILLER_COUNT; i += 1) {
    await seedWiki(request, token, sid, {
      body: `Filler note number ${i} about unrelated everyday backend work.`,
      title: `Filler ${i}`, path: `filler/note-${i}`,
    });
  }
  return csrf;
}

interface CitedRefView { id: string; title: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids: string[] }>;
  wiki_refs: CitedRefView[];
}

async function fetchCitedRefs(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<CitedRefView[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const citedIDs = new Set(assistant?.cited_wiki_ids ?? []);
  return body.wiki_refs.filter((r) => citedIDs.has(r.id));
}
