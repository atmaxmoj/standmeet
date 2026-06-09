// visitor-chat-cited-precise.spec.ts —— cited 列表只含 AI 真读过的 entry。
//
// retrieval redesign 的招牌行为：旧实现把"所有送进 prompt 的 corpus"算作
// cited（弱 ground truth）；新实现 AI 通过 corpus_read 主动 fetch，readCollector
// 累计 path —— cited = AI 实际 read 的 path 列表。
//
// 用户故事：
//   owner 种 4 条 wiki（lucerna / family / sailing / about-me），各自 path
//   独立。visitor 用 code 问"tell me about lucerna" → mock provider 模拟
//   tool-use：corpus_search(query=...) 返回 1 个匹配 → corpus_read(path=
//   projects/lucerna) → 回 text。cited_wiki_refs 只含 projects/lucerna。
//
// UI-driven (G-1): visitor 真开浏览器 → throbber tool-throbber-corpus_search
// + tool-throbber-corpus_read 顺序出现 → answer-body 渲染 → 然后 admin REST
// 取 conversation transcript 验 cited 精度。

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
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';

test.describe('cited reflects AI agent reads, not prompt-stuffed corpus', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const csrf = await seedFourWikis(request);
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'cited-precise spec',
    });
    await request.dispose();
  });

  test('visitor asks narrow question → throbbers fire + cited contains only the read path',
    async ({ browser, playwright }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // Capture conversation_id from the /sessions response.
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

      // Pre-register dialog response wait BEFORE pressing Enter — the POST
      // /dialogs is fire-and-forget right after finalizeTurn; if we wait
      // for answer-body first then attach the listener, the response can
      // already have flown by (registration-after-action race).
      const dialogResponsePromise = page.waitForResponse((res) =>
        res.url().includes('/dialogs') && res.status() === 204,
        { timeout: 20_000 },
      );

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about lucerna');
      await input.press('Enter');

      // 这里只要稳定证明 agent 真 search 真 read 真答了 —— throbber 是瞬时的,
      // 不在这赌它(它的实时性由 throbber-label / throbber-clears 专门验)。用
      // 持久信号:`searched · N` 卡(search 跑过)+ answer-body(turn 落地)。读了
      // 哪个 doc 由下面 cited 转录精确断言(只含 projects/lucerna)。
      await expect(page.getByTestId('tool-card-corpus_search'))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 20_000 });

      // Wait until the dialog record endpoint completes so the transcript
      // query below sees the assistant message + cited refs (D-5 fix).
      await dialogResponsePromise;

      expect(conversationID).not.toBe('');

      const reqCtx = await playwright.request.newContext();
      const { csrf } = await loginAPI(reqCtx, OWNER.email, OWNER.password);
      const cited = await fetchCitedRefs(reqCtx, csrf, conversationID);
      expect(cited.wiki.map((r) => r.path)).toEqual([TARGET_PATH]);
      await reqCtx.dispose();

      await ctx.close();
    });
});

async function seedFourWikis(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cited-precise-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool I built.',
    title: 'Lucerna', path: TARGET_PATH,
  });
  await seedWiki(request, token, sid, {
    body: 'my mother is from singapore.',
    title: 'Family', path: 'personal/family',
  });
  await seedWiki(request, token, sid, {
    body: 'I sail on weekends.', title: 'Sailing', path: 'hobbies/sailing',
  });
  await seedWiki(request, token, sid, {
    body: 'engineer in toronto, building tools for thought.',
    title: 'About me', path: 'intro/about-me',
  });
  return csrf;
}

interface CitedRefView { id: string; title: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids: string[]; cited_output_ids: string[] }>;
  wiki_refs: CitedRefView[];
  output_refs: CitedRefView[];
}

async function fetchCitedRefs(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<{ wiki: CitedRefView[]; output: CitedRefView[] }> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const wikiCited = new Set(assistant?.cited_wiki_ids ?? []);
  const outputCited = new Set(assistant?.cited_output_ids ?? []);
  return {
    wiki: body.wiki_refs.filter((r) => wikiCited.has(r.id)),
    output: body.output_refs.filter((r) => outputCited.has(r.id)),
  };
}
