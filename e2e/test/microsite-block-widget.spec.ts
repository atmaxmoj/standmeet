// microsite-block-widget.spec.ts — a microsite USES a plugin (block) directly, outside the chat
// loop. AgentWidget already lets a microsite reach blocks THROUGH the LLM turn; this drives the
// other path: the owner drops <BlockWidget tool="…"/> on a page, and clicking it invokes that
// block's tool over the visitor's adopted session and renders the block's own result — no chat,
// no model.
//
// The block runs SERVER-SIDE on the code-gated tool endpoint (POST /api/v1/sessions/{id}/tools/
// {name}), so the ACL is the same as chat: a tool the code did not grant is refused. This proves
// the SDK surface (useBlockTool → the endpoint, over the adopted session) end to end.
//
// Witness: ask_visitor (acl: always, deterministic echo). The widget calls it with a probe
// question and renders the echoed JSON — the probe string can only appear if the call reached the
// block and came back, so a stubbed/absent call is falsified.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/microsite-rig';
import { openGate, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'micrositeblock@example.com', password: 'correct-horse-battery-staple',
  handle: 'micrositeblock', fullName: 'Microsite Block Owner',
};
const CODE = 'MSBLOCK-1';
const SLUG = 'blockpage';
const PROBE = 'MICROSITE-BLOCK-PROBE';

// PAGE — a microsite whose body is a BlockWidget bound to the ask_visitor block. Importing it from
// the shipped @standmeet/sdk is the point: this drives the real widget, not a stand-in.
const PAGE = `
import React from 'react';
import { BlockWidget } from '@standmeet/sdk';
export default function App() {
  return (
    <main className="p-8">
      <BlockWidget
        tool="ask_visitor"
        args={{ question: '${PROBE}', kind: 'yes_no' }}
        runLabel="Run the plugin"
      />
    </main>
  );
}
`.trim();

// enterGate — enter the code at /gate; this issues + STORES the session blob in localStorage, which
// the microsite's BlockWidget adopts (same origin) to authenticate the tool call.
async function enterGate(page: Page): Promise<void> {
  await openGate(page, '/gate');
  await page.getByTestId('gate-code').fill(CODE);
  await page.getByTestId('gate-visitor-name').fill('Block Reader');
  await page.getByTestId('gate-code-submit').click();
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 10_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: CODE, label: 'msblock' });
  await publishPage(request, csrf, SLUG, PAGE); // create → write → build → promote live
  await request.dispose();
}

test.describe.configure({ timeout: 420_000 });

test.describe('SDK · a microsite invokes a plugin (block) tool directly and renders its result', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(420_000);
    await initOwner(playwright);
  });

  test('BlockWidget over the adopted session runs the block and renders the echoed result',
    async ({ page }: { page: Page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await enterGate(page); // stores the code's session blob
      await openReader(page, `/p/${SLUG}/`);

      const widget = page.getByTestId('block-widget');
      await expect(widget, 'the BlockWidget rendered').toBeVisible({ timeout: 20_000 });
      expect(pageErrors, 'the microsite mounted without throwing').toEqual([]);
      // Granted + adopted → the run control is live, not the "no session" disabled shell.
      await expect(widget, 'the widget adopted the session and the tool is granted')
        .toHaveAttribute('data-state', 'ready');

      await page.getByTestId('block-widget-run').click();

      // The block ran server-side and its own result came back — the probe can only appear if the
      // call reached ask_visitor and returned.
      await expect(page.getByTestId('block-widget-result'),
        'the block executed and its result rendered on the page')
        .toContainText(PROBE, { timeout: 20_000 });
    });
});
