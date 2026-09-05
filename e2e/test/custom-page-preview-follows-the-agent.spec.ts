// custom-page-preview-follows-the-agent.spec.ts — the owner can see it while directing
// the agent to change the page.
//
// Defect (in the owner's own words, 2026-08-31): "Just give me a panel where I can see
// the effect, and let me see it live while I'm directing the agent to make changes."
//
// Today `/admin/custom-pages` is **a table** — slug, which codes are bound, whether
// there's a live build. It says not one word about what the page actually looks like.
// And the one actually writing these pages is Claude (the panel's own intro literally
// says "Owner creates / builds / promotes via MCP"), so the owner ends up in the worst
// position: they're issuing instructions, and the only feedback is one line saying
// "has_live: true".
//
// There's another layer: `/p/{slug}` **only serves the live build**
// (`ResolveLiveBuild`). So the version Claude just built and hasn't promoted yet is
// nowhere the owner can see it at all — and that's exactly the version they need to
// see (to decide whether to ship it). The preview has to look at **staging**.
//
// Three criteria; the third is the entire point of this test:
//   1. The panel actually renders this page (not just a status line)
//   2. What it shows is **staging** — the version Claude just built but hasn't shipped
//   3. Claude makes another change, and the owner sees the new version **without
//      reloading the page**
//
// #3 can't be faked with "reopen the panel and then assert the new content": that tests
// "it's correct after a refresh", while the owner's complaint is precisely "I have to go
// refresh it myself". So this test never reloads, from start to finish.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'previewer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'previewer',
  fullName: 'Pia Previewer',
};
const SLUG = 'press-kit';

// pageSource — the version the agent writes in. `marker` is this version's unique tag:
// asserting "it changed" needs something that belongs only to this instance, otherwise
// the two versions look alike and the assertion is always green
// ([[widened-response-reaims-assertions]]).
function pageSource(marker: string): string {
  return `export default function App() {
  return <main><h1 data-sm="headline">${marker}</h1></main>;
}`;
}

interface Agent { request: Parameters<typeof callTool>[0]; token: string; sid: string }

// agentBuilds — goes through **MCP**, not admin REST: this is the path the owner meant by
// "directing the agent to change it", and it's exactly this path the panel needs to keep
// up with. Driving it via REST instead would test a different path
// ([[which-path-is-the-green-on]]).
async function agentBuilds(a: Agent, marker: string): Promise<void> {
  await callTool(a.request, a.token, a.sid, 'custom_page.write_file', {
    slug: SLUG, path: 'App.tsx', content: pageSource(marker),
  });
  await callTool(a.request, a.token, a.sid, 'custom_page.build', { slug: SLUG });
}

// headlineIn — the headline text inside the split editor's live preview iframe (the owner opens a
// page from the list, then watches its render on the right).
function headlineIn(page: Page) {
  return page.frameLocator('[data-testid="custom-page-staging-frame"]')
    .locator('[data-sm="headline"]');
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// A real build takes tens of seconds, and this test case builds twice.
test.describe.configure({ timeout: 600_000 });
test.describe('custom pages · the panel shows what the agent just built, without a reload', () => {
  let agent: Agent;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'preview-spec');
    agent = { request, token, sid: await initMCP(request, token) };
    await callTool(request, token, agent.sid, 'custom_page.create', {
      slug: SLUG, title: 'Press kit',
    });
  });

  test('the panel renders the staging build, and follows the next one live',
    async ({ adminPage: page }) => {
      // ── agent builds the first version ──────────────────────────────────
      await agentBuilds(agent, 'FIRST-VERSION');

      // The follow is driven by a long-poll held connection (like waiting on a payment QR),
      // not a fixed poll interval: the panel holds GET /custom-pages/wait open and is
      // answered the instant a build settles. Catch that request — the old fixed-interval
      // code never opens it, so this both proves the mechanism and would go red on a regress.
      const longPoll = page.waitForRequest(
        (req) => req.url().includes('/custom-pages/wait'), { timeout: 30_000 },
      );

      // The redesign gives each page its own editor route (/admin/edit/<slug>); its right pane
      // renders this page's live build. Go straight there — the list → editor click-through is
      // covered in custom-page.spec, and clicking a list row while builds are settling races the
      // list's own re-render. The preview-follow is what THIS test is about: it rides the shared
      // long-poll (useCustomPages), which the editor route holds open too — catch it to prove the
      // held connection exists here, not just on the list.
      await goto(page, `/admin/edit/${SLUG}`);
      await longPoll;

      // 1 + 2: the panel actually renders this page, and what it shows is **staging**
      // (never promoted to live).
      await expect(headlineIn(page), '面板上看不到这一页长什么样')
        .toHaveText('FIRST-VERSION', { timeout: 300_000 });

      // ── the owner does nothing. The agent makes another change. ───────────
      await agentBuilds(agent, 'SECOND-VERSION');

      // 3: this is the entire point of this test: **no reload**, the preview keeps up on
      // its own.
      await expect(headlineIn(page), 'owner 得自己刷新才看得到 = 没解决他说的那个问题')
        .toHaveText('SECOND-VERSION', { timeout: 300_000 });
    });
});
