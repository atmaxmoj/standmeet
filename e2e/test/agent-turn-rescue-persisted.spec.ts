// agent-turn-rescue-persisted.spec.ts — a turn the rescue saved is a turn the owner can read.
//
// Found on prod (2026-09-28, the Mattermost mock interview): one answer took ~346 seconds —
// past the 300-second turn wall. The rescue attempt after the wall produced the answer and the
// visitor read it, but the turn is absent from the owner's transcript: the conversation jumps
// from the question before it to the one after.
//
// Mechanism (read from the code): RunAgentTurn runs the turn on a context with the 300s
// timeout, and the rescue runs on its own budget after that context has expired — but the
// end-of-turn persist (acc.onDone → persistTurn(ctx, …)) is handed the SAME expired context.
// The database write fails with "context deadline exceeded", which is only logged.
//
// Needs the short-budget rig (make test-boundary: turn wall 5s, rescue budget 3s). The first
// model call is slower than the wall; the rescue call answers at once — the cell where the
// rescue saves the turn. The assertion is on the owner's record, not on the visitor's screen.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'rescue-persist@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rescueowner',
  fullName: 'Rescue Owner',
};
const CODE = 'RESCUE-01';
const VISITOR = 'Patient Visitor';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const SLOWER_THAN_THE_WALL_MS = 20_000;
const RESCUED = 'The boundary is engineered, not budgeted.';

let admin: APIRequestContext;
let csrf = '';

test.describe('a turn the rescue saved is in the owner\'s record', () => {
  test.beforeAll(async ({ playwright }) => {
    test.skip(process.env['BOUNDARY_TIGHT'] !== '1', 'needs the short-budget rig — run `make test-boundary`');
    test.setTimeout(180_000);
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(admin, OWNER.email, OWNER.password));
    const apiToken = await createAPIToken(admin, csrf, 'rescue-seed');
    const sid = await initMCP(admin, apiToken);
    await seedPublicWiki(admin, apiToken, sid, { body: RESCUED, title: 'Boundary' });
    await createCode(admin, csrf, { code: CODE, label: 'rescue' });
  });

  test.afterAll(async () => { await admin?.dispose(); });

  test('the wall is hit, the rescue answers, and the turn is recorded', async ({ page, playwright }) => {
    test.setTimeout(120_000);
    const req = await playwright.request.newContext();
    // Evidence in hand first (the prod shape), then a model call slower than the wall, then a
    // rescue call that answers at once.
    const toolTag = await scriptMockToolCall(req, { name: 'corpus_search', args: { query: 'boundary' } });
    const slowTag = await scriptMockReplyText(req, 'never arrives', { delayMs: SLOWER_THAN_THE_WALL_MS });
    const rescueTag = await scriptMockReplyText(req, RESCUED);
    await req.dispose();

    await enterCodeSession(page, CODE, VISITOR);
    const input = page.getByTestId('chat-input-field');
    const question = 'walk everything and tell me all of it';
    await input.fill(`${question}${toolTag}${slowTag}${rescueTag}`);
    await input.press('Enter');
    await expect(page.getByTestId('answer-body'), 'the rescue answered the visitor')
      .toContainText(RESCUED, { timeout: 60_000 });

    const list = await admin.get(`${BACKEND}/api/admin/conversations`, { headers: { 'X-Csrftoken': csrf } });
    expect(list.status()).toBe(200);
    const row = ((await list.json()) as { items: { id: string; visitor_name: string }[] }).items
      .find((r) => r.visitor_name === VISITOR);
    expect(row, 'the visitor\'s conversation exists').toBeDefined();
    const detail = await admin.get(`${BACKEND}/api/admin/conversations/${row!.id}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    const bodies = ((await detail.json()) as { messages: { role: string; body: string }[] }).messages
      .map((m) => `${m.role}: ${m.body}`);
    expect(bodies.join('\n'), 'the owner\'s record holds the question and the rescued answer')
      .toContain(RESCUED);
    expect(bodies.some((b) => b.startsWith('visitor: ') && b.includes(question)), 'and the question').toBe(true);
  });
});
