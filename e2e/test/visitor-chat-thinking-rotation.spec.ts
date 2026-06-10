// visitor-chat-thinking-rotation.spec.ts —— #10 的守护。
//
// LLM 在想(没具体 tool 在跑)那几段,throbber 不显干巴巴一个静止的
// "retrieving",而是从词库里每 3 秒取一个词轮换(thinking-words.ts)。这条验:
//   1. 纯思考阶段(没 tool)前端显 answer-pending 那条;
//   2. 等够久,词会换(轮换是真的,不是定死一个);
//   3. 出现的每个词都来自那份「真词库」(不是 spinner / 乱码 / "retrieving")。
//
// 难点同 reading-dom:mock 零延迟看不到。解法:问句嵌 [[think:N]] —— gateway
// 跳过所有 tool、sleep N ms 再出答案,这段时间没 tool 在跑 → 前端一直显 thinking
// 那条,够长就能观察到轮换。N=7000 → 0/3/6s 三个词。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

// 镜像 app/src/lib/page/thinking-words.ts 的 THINKING_WORDS(取自 thesaurus.com
// 的 ponder/contemplate/deliberate 同义动词 + compose 一支)。改词库时同步这里。
const THINKING_WORDS = new Set([
  'thinking', 'considering', 'contemplating', 'deliberating', 'pondering',
  'reflecting', 'weighing', 'mulling', 'musing', 'reasoning', 'ruminating',
  'composing', 'drafting',
]);

test.describe('thinking 阶段 throbber 走词库轮换(非定死)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'thinking-rot-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'thinking-rotation spec',
    });
    await request.dispose();
  });

  test('纯思考阶段:词每 3 秒换、且都来自词库',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // [[think:7000]]:跳过 tool,纯思考 hold 7s(够 0/3/6s 三个词)。
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('just think about it [[think:7000]]');
      await input.press('Enter');

      const pending = page.locator('[data-testid="answer-pending"]');
      await expect(pending).toBeVisible({ timeout: 5_000 });

      // 每 ~250ms 采一次当前词,收集去重,直到看见 ≥2 个不同的词(轮换为真)。
      const seen = await collectWords(pending);

      // 1) 轮换是真的:至少出现过 2 个不同的词。
      expect(seen.size).toBeGreaterThanOrEqual(2);
      // 2) 每个词都来自真词库(不是 "retrieving" / spinner / 空)。
      for (const w of seen) {
        expect(THINKING_WORDS.has(w), `"${w}" 应来自 thinking 词库`).toBe(true);
      }

      await ctx.close();
    });
});

// collectWords —— 每 ~250ms 读一次 answer-pending 的当前词(首 token,去掉尾部
// "· · ·"),收集去重,直到看见 ≥2 个不同的词(即观察到轮换)。用 expect.poll 做
// 采样器:可观察 + 走 spec.timeout,符合 e2e no-sleep 规则(不手卷 waitForTimeout)。
// retrying 态会显 "retrying"(不在词库),正常 think 路径不会重试。
async function collectWords(
  pending: ReturnType<Page['locator']>,
): Promise<Set<string>> {
  const seen = new Set<string>();
  await expect.poll(async () => {
    const raw = await pending.innerText().catch(() => '');
    const word = raw.split(/[·\n]/)[0]?.trim().toLowerCase() ?? '';
    if (word !== '') seen.add(word);
    return seen.size;
  }, { intervals: [250], timeout: 9_000 }).toBeGreaterThanOrEqual(2);
  return seen;
}
