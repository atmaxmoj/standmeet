// visitor-booking.ts —— a visitor enters with a code, gives a name and books a meeting through the
// scripted calendar_book tool call. Returns once the booked card shows: the booking committed.

import type { Browser, Page } from '@playwright/test';

import { expect } from '@/fixtures/test';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { openReader } from '@/fixtures/navigate';

export interface VisitorBooking {
  code: string;
  name: string;
  topic: string;
  hour: number; // UTC hour, 7 days from now
}

export async function bookAsVisitor(browser: Browser, b: VisitorBooking): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await openReader(page, `/?code=${b.code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(b.name);
  await page.getByTestId('visitor-name-submit').click();
  await session;

  const tag = await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: b.topic, duration_min: 30, preferred_times: [inAWeek(b.hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`book me a 30-minute chat next week, please${tag}`);
  await input.press('Enter');
  await expect(page.frameLocator('[data-testid="mcp-app-card-calendar_book"]')
    .getByTestId('book-card-time')).toBeVisible({ timeout: 20_000 });
  return page;
}

function inAWeek(hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
