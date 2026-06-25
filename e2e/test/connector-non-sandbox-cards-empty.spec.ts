// connector-non-sandbox-cards-empty.spec.ts —— booked 外置收尾后,前端 NON_SANDBOX_CARDS
// 里不再有按能力写死的卡(只剩 skill_*/ext_* 的通用 dump 兜底)。可观测代理:一次 booking
// 流程里,booked 卡是 `mcp-app-card-calendar_book` 沙盒 iframe,主 DOM 里**不存在**老的
// 写死 React 卡 `tool-card-calendar_book`。这等价于「写死卡清单清空(booked 项已外置)」。
// (connector-deps-tests.md §一 non-sandbox-cards-empty)
//
// RED until: calendar_book 卡由 booker 插件 serve 成 ui:// 沙盒卡。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

test.describe('connector · booked card is a sandbox iframe; no hardcoded capability card in main DOM', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('book → mcp-app-card-calendar_book iframe 出现,主 DOM 无写死的 tool-card-calendar_book',
    async ({ browser }) => {
      await scriptMockToolCall(seed.request, {
        name: 'calendar_book',
        args: { topic: 'sandbox check', duration_min: 30, preferred_times: [future()] },
      });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterChat(page, seed.code.code);
      await fireTurn(page, 'book me a meeting');

      // booked 卡 = 沙盒 iframe。
      await expect(page.getByTestId('mcp-app-card-calendar_book'),
        'booked card rendered as sandbox iframe').toBeVisible({ timeout: 20_000 });
      // 主 DOM 里没有老写死 React 卡(它已外置,不在 NON_SANDBOX_CARDS)。
      await expect(page.getByTestId('tool-card-calendar_book'),
        '写死 booked 卡已退役').toHaveCount(0);

      await ctx.close();
    });
});

async function enterChat(page: Page, code: string): Promise<void> {
  await enterCodeSession(page, code);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function fireTurn(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

function future(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
