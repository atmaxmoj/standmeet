// real-third-party-mcp-escape.spec.ts —— ADVERSARIAL: a sandboxed server that
// actively TRIES to break out, and proves it can't.
//
// The other sandbox specs use server-filesystem rooted at /plugin, so its own
// app-level allow-list does part of the work. Here the `escapee` plugin runs the
// same server rooted at "/" — NO app-level restriction at all. The ONLY thing
// standing between it and the host is bubblewrap. We then drive it to attempt
// real, dangerous breakout vectors and confirm each one comes back empty:
//
//   1. /var/run/docker.sock — the backend container mounts the docker socket
//      (the skill runner needs it). If a plugin could reach it, it would own the
//      host's docker daemon — full escape. bwrap never mounts /var, so the socket
//      is invisible: listing /var/run finds nothing.
//   2. /etc/standmeet/plugins.json — a real host config file inside the backend
//      container, listing every plugin id. bwrap never mounts /etc, so reading it
//      fails and none of its contents (e.g. "echoer") ever reach the chat.
//
// If the cage leaked, those host secrets would surface in the answer. They don't.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'escapee@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'escapee',
  fullName: 'Escapee Owner',
};

const PLUGIN_ID = 'escapee';

let code = '';

test.describe('ADVERSARIAL: a sandboxed server actively tries to escape — bwrap holds', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'escapee', granted_skills: [PLUGIN_ID],
    });
    code = issued.code;
    await request.dispose();
  });

  test('cannot reach the host docker socket (full-escape vector)',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // list /var/run, where docker.sock lives in the backend container. bwrap
      // never mounts /var → the directory does not exist in the sandbox.
      const toolTag = await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_list_directory`, args: { path: '/var/run' },
      });
      const replyTag = await scriptMockReplyText(request, 'tried to find the docker socket');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, code);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('chat-input-field').fill(`list var run${toolTag}${replyTag}`);
      await page.getByTestId('chat-input-field').press('Enter');
      await expect(page.getByTestId('answer-body'))
        .toContainText('tried to find the docker socket', { timeout: 30_000 });
      // the socket — and the whole /var tree — is invisible to the sandbox.
      await expect(page.getByTestId('chatroom')).not.toContainText('docker.sock');
      await ctx.close();
    });

  test('cannot read host config (/etc/standmeet/plugins.json) — contents never leak',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_read_text_file`, args: { path: '/etc/standmeet/plugins.json' },
      });
      const replyTag = await scriptMockReplyText(request, 'tried to read the host plugin config');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, code);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('chat-input-field').fill(`read the host config${toolTag}${replyTag}`);
      await page.getByTestId('chat-input-field').press('Enter');
      await expect(page.getByTestId('answer-body'))
        .toContainText('tried to read the host plugin config', { timeout: 30_000 });
      // 'echoer' is a plugin id inside that host config; if the read had leaked,
      // it would surface here. bwrap never mounted /etc, so it never does.
      await expect(page.getByTestId('chatroom')).not.toContainText('echoer');
      await ctx.close();
    });
});
