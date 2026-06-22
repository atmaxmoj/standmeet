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

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  setSandboxWorkspaceTTL, runSandboxWorkspaceSweep, listSandboxWorkspaces,
} from '@/fixtures/sandbox';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

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
let request: import('@playwright/test').APIRequestContext;

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
      // 两次完整浏览器 chat turn + TTL 等待 + 两次 sweep —— 30s 默认 timeout 不够。
      test.setTimeout(90_000);
      // 1) a session writes a file → its workspace is provisioned (lazily).
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_write_file`,
        args: { path: '/workspace/note.txt', content: 'visitor-A-data' },
      });
      await scriptMockReplyText(request, 'saved it');
      const ctxA = await browser.newContext();
      const pageA = await ctxA.newPage();
      await enterCodeSession(pageA, code);
      await pageA.getByTestId('chat-input-field').fill('save a note');
      await pageA.getByTestId('chat-input-field').press('Enter');
      await expect(pageA.getByTestId('answer-body'))
        .toContainText('saved it', { timeout: 30_000 });
      await ctxA.close();

      // workspace now exists for that session.
      expect((await listSandboxWorkspaces(request)).length).toBe(1);

      // 2) let the TTL elapse, then run the cron sweep on demand.
      await new Promise((r) => setTimeout(r, 1500));
      await runSandboxWorkspaceSweep(request);

      // expired workspace is gone.
      expect((await listSandboxWorkspaces(request)).length).toBe(0);

      // 3) a workspace written AFTER the sweep (fresh) is NOT deleted by it.
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_write_file`,
        args: { path: '/workspace/note.txt', content: 'visitor-B-data' },
      });
      await scriptMockReplyText(request, 'saved it again');
      const ctxB = await browser.newContext();
      const pageB = await ctxB.newPage();
      await enterCodeSession(pageB, code);
      await pageB.getByTestId('chat-input-field').fill('save another note');
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
