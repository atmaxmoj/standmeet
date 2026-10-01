// im-config-discord.spec.ts —— connecting a Discord bot is done on the card, start to finish.
//
// Owner, 2026-09-30: "im-bridge…我想至少能用discord". The bridge runs the bot from the token the
// owner connects on the Discord card under /admin/suppliers (GET /internal/im/config hands it
// over).
//
// Owner, 2026-10-01: "你最好让这种部署依赖少点，都在ui里面写". On sijie the card took something that
// was not a bot token, said "connected", and the bridge crash-looped — visible only in the
// container logs. And where the token comes from was said only in chat. So:
//   · the card says where to get the token;
//   · Connect asks Discord whether the token is a bot's; a refused token is refused on the card,
//     and the bridge never gets it.
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
// The shape of a bot token, but no bot's: Discord itself refuses it.
const NOT_A_BOT = 'MTAxMDEwMTAxMDEwMTAxMDEw.GhIjKl.abcdefghijklmnopqrstuvwxyz0123456789ABCD';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('discord card', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the card says where the bot token comes from', async ({ adminPage }) => {
    const card = await discordCard(adminPage);
    await expect(card, 'the token field names the place to get it').toContainText(
      'discord.com/developers/applications',
    );
  });

  test('a token Discord refuses is refused on the card; the bridge never gets it',
    async ({ adminPage, request }) => {
      const card = await discordCard(adminPage);
      await card.getByTestId('supplier-field-token').fill(NOT_A_BOT);
      await card.getByTestId('supplier-connect-button').click();
      await expect(card.getByTestId('supplier-error'), 'the card says why').toContainText(
        /Discord did not accept this token/, { timeout: 20_000 },
      );
      await expect(card.getByTestId('supplier-status')).not.toContainText(/^connected/i);
      expect((await imConfig(request))['discord'] ?? '', 'the bridge gets nothing').toBe('');
    });
});

async function discordCard(page: Page) {
  await gotoAdminSection(page, 'suppliers');
  const card = page.getByTestId('supplier-row-discord');
  await expect(card, 'the Discord card is on the suppliers page').toBeVisible({ timeout: 15_000 });
  return card;
}

async function imConfig(request: APIRequestContext): Promise<Record<string, unknown>> {
  const res = await request.get(`${BACKEND}/internal/im/config`);
  expect(res.status(), '/internal/im/config is served').toBe(200);
  const body = await res.json() as { tokens?: Record<string, unknown> };
  return body.tokens ?? { discord: '<missing tokens map>' };
}
