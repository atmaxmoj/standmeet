// microsite-collab-writing.spec.ts —— S2: friends write a novel together on a microsite, mostly by
// talking to the owner's agent (docs/design/scenario-s2-collaborative-writing.md).
//
// Owner decisions (2026-10-02): a page's document limit is the owner's (default 500); a new
// passage appears at once unless the owner turns review on; the agent may add passages; the agent
// is the main way to write.
//
// Two visitors on two codes bound to one page. Black-box: what each open page shows, what the
// agent is handed, and what the owner's admin routes report.
//   1  a passage the agent adds appears on the other open page, with its author, without a reload
//   2  the agent reads the manuscript: a search hands it the passage and who wrote it
//   3  a passage a visitor writes by hand appears live on the other page too
//   4  review on: the agent's passage waits, the agent says so; the owner approves; it appears
//   5  the owner's limit: a full page refuses the agent's next passage, and the agent says so
//   6  the owner deletes a passage and it leaves every open page

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';
import {
  approveStoreDoc, deleteStoreDoc, listStoreDocs, setStorePolicy, setStoreWritable,
} from '@/fixtures/microsite-store';
import { lastGatewayRequest, scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'novel@example.com', password: 'correct-horse-battery-staple',
  handle: 'novelowner', fullName: 'Novel Owner',
};
const SLUG = 'desire-novel';
const P1 = 'The master kept a ledger of everything he never wanted.';
const P2 = 'Every morning the servant added one more line to it.';
const P3 = 'Nobody had ever read the ledger aloud.';
const P4 = 'One day the ledger was full.';

const APP = `import { useState } from 'react';
import { AgentWidget, useMicrositeStore } from '@standmeet/sdk';
export default function App() {
  const { docs, save, error } = useMicrositeStore('passages');
  const [draft, setDraft] = useState('');
  return (
    <main data-testid="microsite">
      <h1>Desire is labor</h1>
      <ol data-sm="manuscript">
        {docs.map((d) => (
          <li key={String(d._id)} data-sm="passage">
            <span data-sm="text">{String(d.text)}</span>
            <span data-sm="author">{d._author ? String(d._author.name) : ''}</span>
          </li>
        ))}
      </ol>
      <textarea data-sm="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button data-sm="add" onClick={() => { void save({ text: draft }).then(() => setDraft('')); }}>Add</button>
      {error ? <p data-sm="error">{error}</p> : null}
      <AgentWidget placeholder="Write with me" />
    </main>
  );
}`;

let admin: APIRequestContext;
let csrf = '';
let ana: Page;
let ben: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, browser }) => {
  test.setTimeout(420_000); // one microsite build + two code sessions
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(admin, OWNER.email, OWNER.password));
  await publishPage(admin, csrf, SLUG, APP);
  await setStoreWritable(admin, csrf, SLUG, true);
  for (const code of ['WRITER-A', 'WRITER-B']) {
    const c = await createCode(admin, csrf, { code, label: code });
    await bindCodeToPage(admin, csrf, c.id, SLUG);
  }
  ana = await openAs(browser, 'WRITER-A', 'Ana');
  ben = await openAs(browser, 'WRITER-B', 'Ben');
});
test.afterAll(async () => {
  await ana?.context().close();
  await ben?.context().close();
  await admin?.dispose();
});

test('1 a passage the agent adds appears on the other open page, with its author', async () => {
  const tag = await scriptMockToolCall(admin, { name: 'store_append', args: { text: P1 } });
  await ask(ana, `Add this to the novel: ${P1} ${tag}`);
  await expect(passage(ben, P1), 'Ben sees it without a reload').toBeVisible({ timeout: 15_000 });
  await expect(passage(ben, P1).locator('[data-sm="author"]'), 'with who wrote it').toContainText('Ana');
});

test('2 the agent reads the manuscript: a search hands it the passage and its author', async () => {
  const tag = await scriptMockToolCall(admin, { name: 'store_search', args: { query: 'ledger' } });
  const reply = await scriptMockReplyText(admin, 'Ana wrote about the ledger.');
  await ask(ben, `Who wrote about the master's ledger? ${tag}${reply}`);
  await expect.poll(async () => (await lastGatewayRequest(admin, tag, P1)).contains,
    { timeout: 30_000, message: 'the passage reaches the agent' }).toBe(true);
  expect((await lastGatewayRequest(admin, tag, 'Ana')).contains, 'with its author').toBe(true);
});

test('3 a passage a visitor writes by hand appears live on the other page', async () => {
  await ben.locator('[data-sm="draft"]').fill(P2);
  await ben.locator('[data-sm="add"]').click();
  await expect(passage(ana, P2), 'Ana sees Ben\'s passage without a reload').toBeVisible({ timeout: 15_000 });
  await expect(passage(ana, P2).locator('[data-sm="author"]')).toContainText('Ben');
});

test('4 with review on, a new passage waits for the owner, then appears when approved', async () => {
  await setStorePolicy(admin, csrf, SLUG, { review: true });
  const tag = await scriptMockToolCall(admin, { name: 'store_append', args: { text: P3 } });
  await ask(ana, `Add: ${P3} ${tag}`);
  await expect.poll(async () => (await lastGatewayRequest(admin, tag, 'review')).contains,
    { timeout: 30_000, message: 'the agent is told the passage waits for review' }).toBe(true);
  const pending = (await listStoreDocs(admin, csrf, SLUG)).find((d) => d.doc['text'] === P3);
  expect(pending, 'the owner sees the waiting passage').toBeDefined();
  expect(pending!.doc['_status'], 'marked as waiting').toBe('pending');
  await expect(passage(ben, P3), 'visitors do not see it yet').toHaveCount(0);
  await approveStoreDoc(admin, csrf, SLUG, pending!);
  await expect(passage(ben, P3), 'approved → it appears live').toBeVisible({ timeout: 15_000 });
  await setStorePolicy(admin, csrf, SLUG, { review: false });
});

test('5 the owner\'s limit: a full page refuses the next passage, and the agent says so', async () => {
  const held = (await listStoreDocs(admin, csrf, SLUG)).length;
  await setStorePolicy(admin, csrf, SLUG, { max_docs: held });
  const tag = await scriptMockToolCall(admin, { name: 'store_append', args: { text: P4 } });
  await ask(ana, `Add: ${P4} ${tag}`);
  await expect.poll(async () => (await lastGatewayRequest(admin, tag, 'full')).contains,
    { timeout: 30_000, message: 'the agent is told the page is full' }).toBe(true);
  await setStorePolicy(admin, csrf, SLUG, { max_docs: 500 });
});

test('6 the owner deletes a passage and it leaves every open page', async () => {
  const p1 = (await listStoreDocs(admin, csrf, SLUG)).find((d) => d.doc['text'] === P1);
  expect(p1).toBeDefined();
  await deleteStoreDoc(admin, csrf, SLUG, p1!);
  await expect(passage(ana, P1), 'gone from Ana\'s page').toHaveCount(0, { timeout: 15_000 });
  await expect(passage(ben, P1), 'gone from Ben\'s page').toHaveCount(0, { timeout: 15_000 });
});

async function openAs(browser: Browser, code: string, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await enterCodeSession(page, code, name);
  await page.waitForURL(`**/p/${SLUG}**`, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Desire is labor' })).toBeVisible({ timeout: 20_000 });
  return page;
}

async function ask(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('agent-widget').getByTestId('chat-input-field');
  await input.fill(text);
  await input.press('Enter');
}

function passage(page: Page, text: string) {
  return page.locator('[data-sm="passage"]').filter({ hasText: text });
}
