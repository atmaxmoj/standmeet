// visitor-chat-throbber-label-per-tool.spec.ts —— G-8 follow-up:
// agent 干完全不同的事 (booking / listing slots / running skill / 调 ext
// mcp) throbber 文案应该跟着变。覆盖之前 throbber-label spec 只测了
// corpus_search/read 一类的 gap。
//
// 实现：scriptMockToolCall 注入每个 tool call，verify 对应的 tool-throbber
// li 文字 = backend ToolSpec.progress_label。

import { test, expect, type Page } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

interface ThrobberCase {
  toolName: string;
  args: Record<string, unknown>;
  expectedLabel: string;
}

const CASES: readonly ThrobberCase[] = [
  {
    toolName: 'calendar_book',
    args: {
      topic: 'Recruiter chat', duration_min: 30,
      preferred_times: [futureHour(7, 14)],
    },
    expectedLabel: 'booking meeting',
  },
  {
    toolName: 'calendar_list_slots',
    args: {
      from_rfc3339: futureMidnight(7),
      until_rfc3339: futureMidnight(8),
      duration_min: 30, step_min: 60,
    },
    expectedLabel: 'listing slots',
  },
];

test.describe('throbber label 随 agent 在干啥而变', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  for (const c of CASES) {
    test(`${c.toolName} throbber 文字 = "${c.expectedLabel}"`,
      async ({ browser }) => {
        await scriptMockToolCall(seed.request, { name: c.toolName, args: c.args });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await visitAsCoded(page, seed.code.code);
        await ask(page, `please ${c.toolName.replace(/_/g, ' ')}`);

        const throbber = page.getByTestId(`tool-throbber-${c.toolName}`);
        await expect(throbber).toBeVisible({ timeout: 20_000 });
        await expect(throbber).toContainText(c.expectedLabel);

        await ctx.close();
      });
  }
});

async function prep(playwright: Playwright): Promise<CodedSeed> {
  return seedCodeVisitorOnConnectedOwner(playwright, {
    granted_skills: ['calendar.book'],
  });
}

async function visitAsCoded(page: Page, code: string): Promise<void> {
  await page.goto(`/?code=${code}`);
  await page.waitForResponse((r) =>
    r.url().endsWith('/api/v1/sessions') && r.status() === 200);
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
  const skip = page.getByTestId('visitor-name-skip');
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skip.click();
  }
}

async function ask(page: Page, q: string): Promise<void> {
  const input = page.locator('[data-testid="chat-input"] input');
  await input.fill(q);
  await input.press('Enter');
}

function futureMidnight(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function futureHour(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
