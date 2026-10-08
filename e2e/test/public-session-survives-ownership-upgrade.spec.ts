// public-session-survives-ownership-upgrade.spec.ts —— a public visitor mid-chat when the
// conversation-ownership fix (9289a3b88) deploys keeps chatting.
//
// That fix records, at issue, the one conversation a public / BYOAI session owns, and refuses a
// session that names any other. A session issued by an older release carries no such record, so
// after the deploy it owns nothing and every turn is refused. The SDK keeps the session in the
// browser and adopts it again on reload — so "reload and it fixes itself" is a claim to test, not
// to assume: a visitor whose chat silently stops working until they clear site data is a broken
// product that no log shows.
//
// The old-release session is manufactured exactly: the `conversation_id` field is cut out of the
// stored session JSON in Redis (a field-level edit — decoding and re-encoding with Lua's cjson
// would also turn empty arrays into objects and break the session some other way).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, redisEval, resetInstance } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'oldsession@example.com', password: 'correct-horse-battery-staple',
  handle: 'oldsession', fullName: 'Old Session Owner',
};
const SLUG = 'ask-oldsession';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask" /></main>;
}`;

// Cuts "conversation_id" out of every stored visitor session; returns how many it changed.
const FORGET_OWNERSHIP = `
local n = 0
for _, k in ipairs(redis.call('KEYS', 'vsession:*')) do
  local v = redis.call('GET', k)
  local w = string.gsub(v, '"conversation_id":"[^"]*",', '')
  w = string.gsub(w, ',"conversation_id":"[^"]*"', '')
  if w ~= v then redis.call('SET', k, w, 'KEEPTTL'); n = n + 1 end
end
return n`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('visitor · a public session from before the ownership fix keeps working', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000); // one microsite build
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    await publishPage(request, csrf, SLUG, APP);
    await request.dispose();
  });

  test('chat → the session loses its ownership record (an old release) → reload → the next question is answered',
    async ({ playwright, browser }) => {
      test.setTimeout(180_000);
      const request = await playwright.request.newContext();
      const visitor = await (await browser.newContext()).newPage();
      await openReader(visitor, `/p/${SLUG}`);
      await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

      await ask(visitor, await scriptMockReplyText(request, 'before the deploy'), 'first question', 'before the deploy');

      expect(Number(redisEval(FORGET_OWNERSHIP)), 'the stored public session was rewritten to the old shape')
        .toBeGreaterThan(0);

      // "Reload fixes it" — the claim under test. The browser keeps its stored session.
      await visitor.reload();
      await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
      await ask(visitor, await scriptMockReplyText(request, 'after the deploy'), 'second question', 'after the deploy');

      await visitor.context().close();
      await request.dispose();
    });
});

test.describe('visitor · mid-chat when the ownership fix deploys (no reload)', () => {
  test('the open tab\'s next question is answered, not refused', async ({ playwright, browser }) => {
    test.setTimeout(180_000);
    const request = await playwright.request.newContext();
    const visitor = await (await browser.newContext()).newPage();
    await openReader(visitor, `/p/${SLUG}`);
    await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
    await ask(visitor, await scriptMockReplyText(request, 'tab open'), 'first question', 'tab open');

    expect(Number(redisEval(FORGET_OWNERSHIP)), 'the stored public session was rewritten to the old shape')
      .toBeGreaterThan(0);

    // No reload: the visitor just keeps typing in the same tab.
    await ask(visitor, await scriptMockReplyText(request, 'still answered'), 'second question', 'still answered');

    await visitor.context().close();
    await request.dispose();
  });
});

async function ask(page: Page, tag: string, question: string, answer: string): Promise<void> {
  const widget = page.getByTestId('agent-widget');
  const input = widget.getByTestId('chat-input-field');
  await input.fill(`${question} ${tag}`);
  await input.press('Enter');
  await expect(widget.getByTestId('answer-body').last()).toContainText(answer, { timeout: 30_000 });
}
