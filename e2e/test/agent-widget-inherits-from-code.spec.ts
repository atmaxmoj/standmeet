// agent-widget-inherits-from-code.spec.ts —— the embedded AgentWidget IS the code's agent.
//
// The owner ruling (embedded-agent-inherits-structurally): the agent a microsite drops in must
// INHERIT everything the access code grants — corpus scope, persona, quota, dock buttons — with no
// per-block decision in the widget; a new block inherits by structure, and a TEST (this
// one) enforces it rather than the widget asserting it.
//
// Setup: a role with a corpus scope + a dock button + a persona mark; a code assuming it; a custom
// page whose whole body is `<AgentWidget/>`, built + published. A visitor enters at /gate (which
// stores the code's session blob), then opens the microsite — where the widget ADOPTS that
// session. Asserted:
//   1. it renders inline (grant detected — not the codeless /gate handoff);
//   2. the code's dock button renders (inherited from the stored blob);
//   3. asking a question takes a real turn through the ADOPTED session, and the answer carries the
//      role persona mark — proving corpus/persona/accounting all came from the code (the mock
//      gateway echoes the system prompt it receives, so the mark can only appear if the code's
//      persona reached the model);
//   4. clicking the dock button sends its trigger as a visitor message.
//
// A codeless visit is the counter-case: no blob → the widget must be the /gate handoff, not inline.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openGate, openReader } from '@/fixtures/navigate';
import { createPrompt } from '@/fixtures/prompts';
import { createRole } from '@/fixtures/roles';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'agentwidget@example.com', password: 'correct-horse-battery-staple',
  handle: 'agentwidget', fullName: 'Agent Widget Owner',
};
const CODE = 'AGENTW-1';
const ROLE = 'agentw-role';
const SLUG = 'agentw-page';
const BLOCK_SUMMARIZE = 'summarize_conversation';
const TRIGGER = 'Summarize our conversation so far';
// A sentence that can ONLY come from the role persona (not the corpus, not any generic header) —
// its appearance in an answer proves the code's persona reached the model through the adopted
// session (the mock gateway echoes the system prompt verbatim).
// SESSION_KEY —— the localStorage key the gate writes and the SDK adopts. Spelled out here
// because e2e cannot import @standmeet/sdk-core (no exports main). A drift between this literal
// and the SDK's own constant cannot go unnoticed: the widget would fail to adopt at all, and
// assertion 1 (data-mode="inline") is red before this probe is ever reached.
const SESSION_KEY = 'standmeet:visitor-session';
const PERSONA_MARK = 'AGENTW-PERSONA-ECHO-XYZ';

// PAGE —— a microsite whose entire body is the AgentWidget. Importing it from the shipped
// @standmeet/sdk is the point: this drives the real widget, not a stand-in.
const PAGE = `
import React from 'react';
import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main className="p-8"><AgentWidget /></main>;
}
`.trim();

interface ApiResult { status: number; body: Record<string, unknown> }

async function pagesApi(
  request: APIRequestContext, csrf: string,
  method: 'get' | 'post' | 'put', path: string, data?: unknown,
): Promise<ApiResult> {
  const url = `${BACKEND}/api/admin/microsites${path}`;
  const opts = { headers: { 'X-Csrftoken': csrf }, ...(data === undefined ? {} : { data }) };
  const res = method === 'get'
    ? await request.get(url, opts)
    : method === 'put' ? await request.put(url, opts) : await request.post(url, opts);
  const body = res.ok() ? (await res.json()) as Record<string, unknown> : {};
  return { status: res.status(), body };
}

async function publishPage(request: APIRequestContext, csrf: string): Promise<void> {
  await pagesApi(request, csrf, 'post', '/', { slug: SLUG, title: SLUG });
  await pagesApi(request, csrf, 'put', `/${SLUG}/files`, { path: 'App.tsx', content: PAGE });
  const started = await pagesApi(request, csrf, 'post', `/${SLUG}/build`);
  expect(started.status, 'start build').toBe(200);
  const id = started.body['build_id'] as string;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = (await pagesApi(request, csrf, 'get', `/builds/${id}`)).body;
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  const live = await pagesApi(request, csrf, 'post', `/${SLUG}/live`, { build_id: id });
  expect(live.status, 'promote to live').toBe(200);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // A prompt carrying the persona mark, assigned to the role — the same thing the owner does on
  // /admin/prompts + /admin/roles. The role also grants a corpus scope + a dock button; the code
  // assumes the role, so all three must reach the embedded agent.
  const promptID = await createPersonaPrompt(request, csrf);
  const role = await createRole(request, csrf, {
    name: ROLE, description: 'agent widget carrier', greeting: '', prompt_id: promptID,
    corpus_uris: ['wiki://**'],
    dock_buttons: [{ block_id: BLOCK_SUMMARIZE, trigger: TRIGGER }],
  });
  await createCode(request, csrf, { code: CODE, label: 'agentw', assumed_role_id: role.id });
  const token = await createAPIToken(request, csrf, 'agentw-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    title: 'Current Work', body: 'I am wiring the deterministic state holder.', path: 'current-work',
  });
  await publishPage(request, csrf);
  await request.dispose();
}

// createPersonaPrompt —— the role's prompt body, which the assembled system prompt carries (and
// the mock echoes). Returns the prompt id to set on the role.
async function createPersonaPrompt(request: APIRequestContext, csrf: string): Promise<string> {
  const p = await createPrompt(request, csrf, {
    name: 'agentw-persona', body: `${PERSONA_MARK}. Speak plainly.`,
  });
  return p.id;
}

// enterGate —— enter the code at /gate; this issues + STORES the session blob (with the code's
// dock buttons + persona) in localStorage, which the microsite then adopts.
async function enterGate(page: Page): Promise<void> {
  await openGate(page, '/gate');
  await page.getByTestId('gate-code').fill(CODE);
  await page.getByTestId('gate-visitor-name').fill('Embedded Reader');
  await page.getByTestId('gate-code-submit').click();
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 10_000 });
}

// storedDockButtons —— what /gate actually persisted, read off the blob the widget adopts.
//
// The widget's dock has two halves — the gate WRITES the buttons into the session blob, the SDK
// READS them back out of it — and "no button on screen" is the same picture either way. Asserting
// only the rendered button made the red unable to say which half broke, and the diagnosis carried
// in docs/full-suite-failures.md for two rounds blamed a third place entirely (resolveDockButtons
// dropping the block), which dock-buttons.spec.ts D2-D4 disprove. Read the blob, so the red names
// a side.
async function storedDockButtons(page: Page): Promise<unknown> {
  return await page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>)['dock_buttons'];
  }, SESSION_KEY);
}

test.describe.configure({ timeout: 420_000 });

test.describe('the embedded AgentWidget inherits the code (corpus + persona + dock)', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    await initOwner(playwright);
  });

  test('codeless visit → the widget is the /gate handoff, not an inline agent', async ({ page }) => {
    await openReader(page, `/p/${SLUG}/`);
    const w = page.getByTestId('agent-widget');
    await expect(w).toBeVisible({ timeout: 20_000 });
    await expect(w).toHaveAttribute('data-mode', 'gate');
  });

  test('with the code adopted → inline agent, inherits dock + persona, dock sends its trigger',
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      const tag = await scriptMockReplyText(request, 'noted.');
      // A widget that throws while mounting renders its shell and drops everything the effect
      // would have added — which looks exactly like "the dock was not configured".
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await enterGate(page); // stores the code's session blob

      // Which half? — the gate must have PUT the code's dock button into the blob before the
      // widget can be blamed for not rendering it.
      // The SDK guard (isDockButton) drops any entry missing ANY of block_id/title/trigger, so
      // the probe asserts the WHOLE shape it demands — a toMatchObject on two of the three would
      // pass while the third is absent and the dock silently renders empty.
      const stored = await storedDockButtons(page);
      expect(stored, '/gate persisted the code dock buttons into the session blob')
        .toMatchObject([{ block_id: BLOCK_SUMMARIZE, trigger: TRIGGER }]);
      expect((stored as Array<Record<string, unknown>>)[0],
        'the stored button carries every field the SDK guard requires')
        .toEqual({ block_id: BLOCK_SUMMARIZE, title: expect.any(String), trigger: TRIGGER });

      await openReader(page, `/p/${SLUG}/`);

      // …and the blob must still be readable FROM THE MICROSITE PAGE. /gate and /p/<slug>/ are
      // only one localStorage if they are one origin; if they are not, everything above still
      // passes and the widget simply sees nothing.
      expect(await storedDockButtons(page),
        'the microsite page reads the same session blob /gate wrote')
        .toMatchObject([{ block_id: BLOCK_SUMMARIZE }]);

      const w = page.getByTestId('agent-widget');
      await expect(w).toBeVisible({ timeout: 20_000 });
      expect(pageErrors, 'the microsite mounted without throwing').toEqual([]);
      // What the adopt effect actually resolved. "0" means the widget read nothing; "1" with no
      // button on screen would mean the render, not the read.
      await expect(w, 'the adopt effect resolved the code dock button')
        .toHaveAttribute('data-dock-count', '1');
      // 1. grant adopted → inline, not the handoff.
      await expect(w).toHaveAttribute('data-mode', 'inline');
      // 2. the code's dock button is inherited from the stored blob.
      await expect(page.getByTestId(`agent-widget-dock-${BLOCK_SUMMARIZE}`))
        .toBeVisible({ timeout: 10_000 });

      // 3. a turn runs through the ADOPTED session, and the answer carries the persona mark.
      await page.getByTestId('agent-widget-input').fill(`what are you working on ${tag}`);
      await page.getByTestId('agent-widget-ask').click();
      await expect(page.getByTestId('agent-widget-transcript'))
        .toContainText('noted.', { timeout: 30_000 });
      await expect(page.getByTestId('agent-widget-transcript'),
        'the code persona reached the model through the adopted session')
        .toContainText(PERSONA_MARK, { timeout: 30_000 });

      // 4. clicking the dock button sends its trigger as a visitor message.
      await page.getByTestId(`agent-widget-dock-${BLOCK_SUMMARIZE}`).click();
      await expect(page.getByTestId('agent-widget-transcript'))
        .toContainText(TRIGGER, { timeout: 15_000 });
    });
});
