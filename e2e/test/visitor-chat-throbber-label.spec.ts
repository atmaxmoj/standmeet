// visitor-chat-throbber-label.spec.ts —— throbber 反映的是 agent 的实时行为:
// 它是 /agent/turn SSE 流里 tool_started 事件的 1:1 视图(单值,后来的顶替前面
// 的)。throbber 文案 = backend 每个 tool 注册的 progress_label + corpus 读类再
// 叠上「在读哪个 document」(throbber-label.ts)。
//
// 验法:**发问前先挂一个 SSE response listener**,把 /agent/turn 整条流录下来 ——
// agent 每一步都实打实在网络上流过,跟 React 画不画无关(mock 零延迟 turn 里
// 中间帧会被 batch 掉,DOM 上根本来不及画,但事件流一条不少)。断言流里 agent
// 按序 emit 了 corpus_search(带 backend progress_label)→ corpus_read(args.path
// = 在读的 document),这正是 throbber 逐帧显示的内容来源。
//
// throbber 的「单值不堆叠」是结构性保证(use-chat 的 currentTool 是单值,类型
// 上不可能堆);「turn 落地即清」由 visitor-chat-throbber-clears 专门兜。

import { test, expect } from '@/fixtures/test';
import type { Response } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';

interface ToolStarted {
  name: string;
  path: string;
  progressLabel: string;
}

test.describe('throbber label 走 backend BindingTool.ProgressLabel registry', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-label-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-label spec',
    });
    await request.dispose();
  });

  test('agent 按序 emit corpus_search → corpus_read(带 progress_label + 在读的 document)',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // 发问前先挂 listener:录整条 /agent/turn SSE。事件流不会被 React batch 掉,
      // 瞬时也好、零延迟也好,agent 的每一步都在里头。
      const turnRespPromise = page.waitForResponse(
        (r) => r.url().includes('/agent/turn') && r.status() === 200,
        { timeout: 20_000 },
      );

      // Mock is pure registration + ordered emission: register corpus_search THEN
      // corpus_read → the agent stream emits them in that order (what the throbber
      // reflects). read path = the seeded document.
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: TARGET_PATH },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag}`);
      await input.press('Enter');

      const started = await collectToolStarted(await turnRespPromise);

      const search = started.find((t) => t.name === 'corpus_search');
      const read = started.find((t) => t.name === 'corpus_read');
      // corpus_search 现过,带 backend 注册的 progress_label(throbber 默认文案源)。
      expect(search).toBeDefined();
      expect(search?.progressLabel ?? '').not.toBe('');
      // corpus_read 现过,args.path = 在读的那个 document(owner: "他到底在读什么")。
      expect(read).toBeDefined();
      expect(read?.path).toBe(TARGET_PATH);
      // 顺序:先 search 再 read。
      expect(started.findIndex((t) => t.name === 'corpus_search'))
        .toBeLessThan(started.findIndex((t) => t.name === 'corpus_read'));

      await ctx.close();
    });
});

// collectToolStarted —— 读完整条 SSE(stream 结束 = turn 落地),抽出所有
// tool_started 帧:event: tool_started / data: {name,args,progress_label}。
async function collectToolStarted(resp: Response): Promise<ToolStarted[]> {
  const raw = await resp.text();
  const out: ToolStarted[] = [];
  for (const block of raw.split('\n\n')) {
    const frame = parseFrame(block);
    if (frame === null || frame.event !== 'tool_started') continue;
    out.push(frameToToolStarted(frame.data));
  }
  return out;
}

function parseFrame(block: string): { event: string; data: string } | null {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data = line.slice(6).trim();
  }
  return event === '' ? null : { event, data };
}

function frameToToolStarted(data: string): ToolStarted {
  const d = safeRecord(data);
  const args = isRecord(d['args']) ? d['args'] : {};
  return {
    name: strOf(d['name']),
    path: strOf(args['path']),
    progressLabel: strOf(d['progress_label']),
  };
}

function safeRecord(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s);
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
