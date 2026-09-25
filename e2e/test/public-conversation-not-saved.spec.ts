// public-conversation-not-saved.spec.ts —— the owner can turn off saving codeless (public/byoai)
// conversations: the visitor still gets an answer, but the turn is never stored.
//
// Differential, so it goes red on either failure:
//   • saving on (the default): a public turn lands in the messages table.
//   • owner flips the admin toggle off → the next public turn is answered on screen, the backend
//     reaches its write step (its log line is the receipt — without it, "0 rows" would also be
//     what a turn that never finished looks like), and no message row for it exists. The turn
//     saved earlier is still there: turning saving off doesn't delete anything.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import {
  backendLogTail, execSQL, findSetupToken, querySQL, resetInstance,
} from '@/fixtures/instance';
import { gotoAdminSection, openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'notsaved@example.com', password: 'correct-horse-battery-staple',
  handle: 'notsaved', fullName: 'Not Saved Owner',
};
const SLUG = 'ask-notsaved';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask" /></main>;
}`;
const SAVED_Q = 'SAVEDQ_marker_k3';
const UNSAVED_Q = 'UNSAVEDQ_marker_p8';
const SKIP_LOG = 'turn not saved: public conversation policy';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('conversations · owner can stop saving public conversations', () => {
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

  test('saved by default; toggled off → answered but not stored; earlier turns kept',
    async ({ adminPage, playwright, browser }) => {
      test.setTimeout(180_000);
      const request = await playwright.request.newContext();
      const visitor = await (await browser.newContext()).newPage();
      await openReader(visitor, `/p/${SLUG}`);
      await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

      // Saving on (default): the turn is stored.
      await ask(visitor, await scriptMockReplyText(request, 'first answer'), SAVED_Q, 'first answer');
      await expect.poll(() => messageCount(SAVED_Q), { timeout: 15_000, message: 'default: saved' })
        .toBeGreaterThan(0);

      // The owner turns saving off in admin → conversations.
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByTestId('conv-policy-save-toggle').click();
      await expect(adminPage.getByTestId('conv-prune-status')).toContainText('not saved', { timeout: 10_000 });

      // A new public conversation: answered on screen, but not stored.
      await visitor.getByTestId('agent-widget-clear').click();
      await ask(visitor, await scriptMockReplyText(request, 'second answer'), UNSAVED_Q, 'second answer');
      await expect.poll(() => backendLogTail(2000).includes(SKIP_LOG), {
        timeout: 15_000, message: 'the backend reached its write step and skipped it',
      }).toBe(true);
      expect(messageCount(UNSAVED_Q), 'saving off → the turn is not stored').toBe(0);
      expect(messageCount(SAVED_Q), 'turning saving off deletes nothing').toBeGreaterThan(0);

      await visitor.context().close();
      await request.dispose();
    });
});

async function ask(page: Page, tag: string, question: string, answer: string): Promise<void> {
  await page.getByTestId('agent-widget-input').fill(`${question} ${tag}`);
  await page.getByTestId('agent-widget-ask').click();
  await expect(page.getByTestId('agent-widget-transcript')).toContainText(answer, { timeout: 30_000 });
}

function messageCount(marker: string): number {
  return Number(querySQL(`SELECT count(*) FROM messages WHERE body LIKE '%${marker}%'`));
}
