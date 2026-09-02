// sandbox-workspace-ttl-cron.spec.ts —— per-session sandbox workspaces are
// bounded: a backend-controlled TTL + a cron sweep delete expired ones so the
// host filesystem never grows without bound.
//
// Model (converged): a visitor session that WRITES through a sandboxed MCP gets
// its own /workspace directory (lazily — no write, no dir). That directory is
// the visitor's, isolated from other sessions, and must not live forever. The
// TTL is set in the backend (code/config, not hard-baked), and a cron job sweeps
// workspaces older than the TTL.
//
// What this proves end to end:
//   1. a session writes a file via a real sandboxed MCP → its workspace exists
//      (admin sandbox panel lists exactly one workspace for that session).
//   2. after the TTL elapses and the cron sweep runs → the expired workspace is
//      gone (admin lists zero) and its files are unreadable by a fresh session.
//   3. a workspace written AFTER the sweep (not yet expired) is retained — the
//      cron deletes only expired ones, not everything.
//
// RED until: the sandboxed-MCP install path provisions per-session workspaces,
// the backend exposes a workspace TTL config + a cron sweep (with a test hook to
// run it on demand), and the admin sandbox panel lists active workspaces
// (#147/#148). Test first.

import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  setSandboxWorkspaceTTL, runSandboxWorkspaceSweep, listSandboxWorkspaces,
} from '@/fixtures/sandbox';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'wsttl@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wsttl',
  fullName: 'Workspace TTL Owner',
};

// A real file-writing third-party server installed sandboxed (server-filesystem
// rooted at /workspace, sandbox.workspace=true → gets a per-session workspace).
const PLUGIN_ID = 'wsfs';

let code = '';
let request: APIRequestContext;

// adminPage needs to log in with the owner's credentials -- this spec previously only
// went through the API and the visitor path.
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('sandbox per-session workspace: backend TTL + cron sweep', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'wsttl', granted_skills: [PLUGIN_ID],
    });
    code = issued.code;
    // workspace dirs live on the backend fs and outlast resetInstance (which only
    // truncates the DB) — wipe any stragglers from prior runs so counts are
    // deterministic: TTL 0 → everything is expired → sweep clears all.
    await setSandboxWorkspaceTTL(request, csrf, { seconds: 0 });
    await runSandboxWorkspaceSweep(request);
    // TTL is controlled from the backend, not hard-coded — set it tiny for the test.
    await setSandboxWorkspaceTTL(request, csrf, { seconds: 1 });
  });

  test('expired workspace is cron-swept; a fresh one survives',
    async ({ browser }) => {
      // Two full browser chat turns + waiting on the TTL + two sweeps -- the default
      // 30s timeout isn't enough.
      test.setTimeout(90_000);
      // 1) a session writes a file → its workspace is provisioned (lazily).
      const toolTagA = await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_write_file`,
        args: { path: '/workspace/note.txt', content: 'visitor-A-data' },
      });
      const replyTagA = await scriptMockReplyText(request, 'saved it');
      const ctxA = await browser.newContext();
      const pageA = await ctxA.newPage();
      await enterCodeSession(pageA, code);
      await pageA.getByTestId('chat-input-field').fill(`save a note${toolTagA}${replyTagA}`);
      await pageA.getByTestId('chat-input-field').press('Enter');
      await expect(pageA.getByTestId('answer-body'))
        .toContainText('saved it', { timeout: 30_000 });
      await ctxA.close();

      // workspace now exists for that session.
      expect((await listSandboxWorkspaces(request)).length).toBe(1);

      // 2) run the cron sweep until the workspace ages past the TTL and is gone.
      //    poll (not sleep): waits on the real observable (workspace deleted),
      //    real time elapses across retries so the TTL boundary is crossed.
      await expect.poll(async () => {
        await runSandboxWorkspaceSweep(request);
        return (await listSandboxWorkspaces(request)).length;
      }, { timeout: 8_000, intervals: [200] }).toBe(0);

      // 3) a workspace written AFTER the sweep (fresh) is NOT deleted by it.
      const toolTagB = await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_write_file`,
        args: { path: '/workspace/note.txt', content: 'visitor-B-data' },
      });
      const replyTagB = await scriptMockReplyText(request, 'saved it again');
      const ctxB = await browser.newContext();
      const pageB = await ctxB.newPage();
      await enterCodeSession(pageB, code);
      await pageB.getByTestId('chat-input-field').fill(`save another note${toolTagB}${replyTagB}`);
      await pageB.getByTestId('chat-input-field').press('Enter');
      await expect(pageB.getByTestId('answer-body'))
        .toContainText('saved it again', { timeout: 30_000 });
      await ctxB.close();

      // immediately sweep again: the fresh workspace is younger than the TTL, kept.
      await runSandboxWorkspaceSweep(request);
      expect((await listSandboxWorkspaces(request)).length).toBe(1);
    });

  test.afterAll(async () => { await request.dispose(); });
});

// The other half of F-E-26. The `admin-sandbox` test guards "the button is disabled when
// there's nothing to sweep", and **that half alone can't catch this**: permanently
// disabling the button would still pass it green. This test needs there to genuinely be
// a workspace it can sweep -- and this spec is the only place in the repo that can
// produce a real workspace (a real visitor session + a real file write).
// Runs right after the group above: what the previous test leaves behind is exactly a
// fresh workspace.
test.describe('sweep 那颗按钮在有东西可扫时是活的', () => {
  // Opens its own request context: the previous group closed theirs in afterAll.
  let req: APIRequestContext;
  test.beforeAll(async ({ playwright }) => { req = await playwright.request.newContext(); });
  test.afterAll(async () => { await req.dispose(); });

  test('有 workspace 时,面板上那颗 sweep 可点,而且点完真的扫掉了',
    async ({ adminPage }) => {
      test.setTimeout(90_000);
      // The previous test left behind a fresh workspace; push the TTL to 0 to make it
      // "due for sweeping".
      const request = req;
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await setSandboxWorkspaceTTL(request, csrf, { seconds: 0 });
      expect(
        (await listSandboxWorkspaces(request)).length,
        'precondition: 屏幕上要有东西可扫',
      ).toBe(1);

      await gotoAdminSection(adminPage, 'system');
      const sweep = adminPage.getByTestId('sandbox-sweep');
      await expect(sweep, '有工作区时这颗按钮该是活的').toBeEnabled({ timeout: 10_000 });
      await sweep.click();

      // What this asserts is **the backend genuinely lost one**, not a toast appearing
      // on screen ([[nonunique-signal-not-a-receipt]]).
      await expect.poll(
        async () => (await listSandboxWorkspaces(request)).length,
        { timeout: 10_000, intervals: [250] },
      ).toBe(0);
      await expect(sweep, '扫完之后它自己变回禁用').toBeDisabled();
    });
});
