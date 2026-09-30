// im-config-discord.spec.ts —— the owner connects a Discord bot the way they connect Telegram, and
// the im-bridge gets that token to run it.
//
// Owner, 2026-09-30: "im-bridge…我想至少能用discord". The bridge is built on the Chat SDK, which ships
// a Discord adapter; what was missing is the owner's side: a Discord card under /admin/suppliers,
// and /internal/im/config handing the bridge a Discord token (it only knew telegram_token). With
// both connected, each platform gets its own token — never the other's.
//
// Driven the way the owner does it: the suppliers page, the Discord card, its token field, Connect.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'imdiscord@example.com', password: 'correct-horse-battery-staple',
  handle: 'imdiscord', fullName: 'IM Discord Owner',
};
// Shapes only: a Discord bot token is three dot-separated parts; a Telegram one is "<id>:<secret>".
const DISCORD_TOKEN = 'MTAxMDEwMTAxMDEwMTAxMDEw.GhIjKl.abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const TELEGRAM_TOKEN = '7654321:BOTFATHER-imdiscord-abcdefghijklmnopqrstuv';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('discord supplier → /internal/im/config', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('connecting the Discord card hands the bridge a Discord token', async ({ adminPage, request }) => {
    expect((await imConfig(request)).discord_token, 'nothing connected yet').toBe('');
    await connectCard(adminPage, 'discord', DISCORD_TOKEN);
    const cfg = await imConfig(request);
    expect(cfg.discord_token, 'the bridge now gets the Discord token').toBe(DISCORD_TOKEN);
    expect(cfg.telegram_token, 'and does not run it as a Telegram bot').toBe('');
  });

  test('with Telegram connected too, each platform gets its own token', async ({ adminPage, request }) => {
    await connectCard(adminPage, 'telegram', TELEGRAM_TOKEN);
    const cfg = await imConfig(request);
    expect(cfg.telegram_token).toBe(TELEGRAM_TOKEN);
    expect(cfg.discord_token).toBe(DISCORD_TOKEN);
  });
});

async function connectCard(page: Page, block: string, token: string): Promise<void> {
  await gotoAdminSection(page, 'suppliers');
  const card = page.getByTestId(`supplier-row-${block}`);
  await expect(card, `the ${block} card is on the suppliers page`).toBeVisible({ timeout: 15_000 });
  await card.getByTestId('supplier-field-token').fill(token);
  await card.getByTestId('supplier-connect-button').click();
  await expect(card.getByTestId('supplier-status')).toContainText(/connected/i, { timeout: 15_000 });
}

async function imConfig(request: APIRequestContext): Promise<Record<string, unknown>> {
  const res = await request.get(`${BACKEND}/internal/im/config`);
  expect(res.status(), '/internal/im/config is served').toBe(200);
  const body = await res.json() as Record<string, unknown>;
  return { telegram_token: body['telegram_token'] ?? '<missing>', discord_token: body['discord_token'] ?? '<missing>' };
}
