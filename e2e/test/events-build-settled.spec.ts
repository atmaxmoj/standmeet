// events-build-settled.spec.ts —— Phase 4 of docs/design/event-bus-outbox-webhooks.md
// (inventory #16): a build settling after a backend restart still reaches the owner's open
// preview.
//
// The owner keeps the page editor open while their agent rebuilds the page; the preview follows
// each build without a reload, woken by a long-poll (GET /microsites/wait, cursor = version).
//
// Now the settle records microsite.build.settled and sends a NOTIFY keyed by the owner in the
// same transaction, and the version is durable (when the owner's latest build settled).
//
// Two cases, and which one guards what:
//   • The preview case is a REGRESSION guard: it was green on the pre-bus code too (seen
//     2026-09-26), because the panel also polls the build it queued until it settles — the
//     long-poll counter resetting on restart was never what the preview depended on.
//   • The settle case is the RED guard: the settle is an event whose follow-up work (the asset
//     references; the home page's auto-publish) runs as durable subscriber jobs, visible in the
//     Tasks event stream. On the pre-bus code there is no such event: those calls ran inline in
//     the builder's request and died with the process.
//
// Behaviour only: the test never waits on /microsites/wait itself — it asserts what the owner
// sees in the preview and in the Tasks panel.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'settle-restart@example.com', password: 'correct-horse-battery-staple',
  handle: 'settlerestart', fullName: 'Settle Restart Owner',
};
const SLUG = 'restart-kit';
// BUILD_BUDGET —— one real build, queued behind whatever the sandbox is already building.
const BUILD_BUDGET = 300_000;

function pageSource(marker: string): string {
  return `export default function App() {
  return <main><h1 data-sm="headline">${marker}</h1></main>;
}`;
}

interface Agent { request: Parameters<typeof callTool>[0]; token: string; sid: string }

// agentBuilds —— the agent rewrites the page and builds it over MCP, as the owner's AI does.
async function agentBuilds(a: Agent, marker: string): Promise<void> {
  await callTool(a.request, a.token, a.sid, 'microsite.write_file', {
    slug: SLUG, path: 'App.tsx', content: pageSource(marker),
  });
  await callTool(a.request, a.token, a.sid, 'microsite.build', { slug: SLUG });
}

function headlineIn(page: Page) {
  return page.frameLocator('[data-testid="microsite-staging-frame"]')
    .locator('[data-sm="headline"]');
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 900_000 });
test.describe('P4 · a build settled after a backend restart still reaches the open preview', () => {
  let agent: Agent;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'settle-restart-spec');
    agent = { request, token, sid: await initMCP(request, token) };
    await callTool(request, token, agent.sid, 'microsite.create', { slug: SLUG, title: 'Restart kit' });
  });

  test.afterAll(async () => { await agent.request.dispose(); });

  test('the preview follows a build that settles after the backend restarted', async ({ adminPage: page }) => {
    await agentBuilds(agent, 'BEFORE-RESTART');
    await openReader(page, `/admin/edit/${SLUG}`);
    await expect(headlineIn(page), 'the preview shows the first build')
      .toHaveText('BEFORE-RESTART', { timeout: BUILD_BUDGET });

    // The editor stays open. The backend restarts under it (an upgrade does exactly this).
    restartBackend();
    agent.sid = await initMCP(agent.request, agent.token);
    await agentBuilds(agent, 'AFTER-RESTART');

    await expect(headlineIn(page), 'the open preview must follow a build settled after the restart')
      .toHaveText('AFTER-RESTART', { timeout: BUILD_BUDGET });
  });

  test('the settle is an event whose follow-up runs as a durable subscriber job', async ({ adminPage: page }) => {
    await agentBuilds(agent, 'SETTLE-EVENT');
    await gotoAdminSection(page, 'tasks');
    const ev = page.locator(`[data-testid="event-row"][data-type="microsite.build.settled"][data-subject="microsite/${SLUG}"]`).first();
    await expect.poll(async () => {
      await page.reload();
      // count() does not wait: read only once the event stream has rendered its rows.
      await page.getByTestId('event-row').first().waitFor();
      return ev.count();
    }, { timeout: BUILD_BUDGET, intervals: [3_000] }).toBeGreaterThan(0);
    await ev.click();
    await expect(page.locator('[data-testid="event-fanout"][data-subscriber="microsite.asset_refs"]'),
      'the asset-reference recompute ran as its own job').toHaveAttribute('data-state', 'completed', { timeout: 60_000 });
  });
});
