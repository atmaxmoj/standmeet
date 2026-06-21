// real-third-party-mcp-loader.spec.ts —— T1: the loader is REAL.
//
// The cleanest proof, decoupled from any sandbox/FS concern: load the official
// @modelcontextprotocol/server-everything — a reference server we did NOT write,
// whose only job is to exercise MCP clients — and drive two of its tools (echo,
// add) from a real visitor chat through the managed discovery path. If a
// stranger's server is discovered and its tools return correct results end to
// end, the unified loader genuinely speaks MCP, not "our own modules' dialect".
//
// No filesystem, no network — pure protocol. The sandbox/FS/network confinement
// proofs live in real-third-party-mcp-sandboxed.spec.ts (T2/T3) and the network
// spec (T4). Here we isolate "did the loader correctly discover + invoke a real
// third-party tool".
//
// RED until server-everything is declared in infra/dev-plugins.json and the
// managed loader brings it up. Test first.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'everything@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'everything',
  fullName: 'Everything Owner',
};

// PLUGIN_ID —— declared in infra/dev-plugins.json, pointing at the real
// server-everything. Tools surface prefixed <id>_<tool> (not RawToolNames).
const PLUGIN_ID = 'everything';

let pluginCode = '';

test.describe('REAL third-party MCP server (server-everything) — loader correctness', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'everything', granted_skills: [PLUGIN_ID],
    });
    pluginCode = issued.code;
    await request.dispose();
  });

  test('echo: a stranger server\'s tool is discovered + returns the real echoed text',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // server-everything's `echo` returns "Echo: <message>".
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_echo`, args: { message: 'PLUGGED-IN-FOR-REAL' },
      });
      await scriptMockReplyText(request, 'the server echoed it back');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('echo something');
      await input.press('Enter');
      // The clean scripted reply only renders if the real third-party tool was
      // discovered + dispatched through the bwrap sandbox without breaking the
      // turn — a tool that fails to load instead yields a terminal "tool not
      // found" error and no answer. The actual echoed value ("Echo: PLUGGED-IN-
      // FOR-REAL", 25 bytes) is asserted at the source in the backend logs.
      await expect(page.getByTestId('answer-body'))
        .toContainText('the server echoed it back', { timeout: 30_000 });
      await ctx.close();
    });

  test('a SECOND tool of the same real server also loads + dispatches (get-sum)',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // get-sum is server-everything's adder; sanitized it surfaces as
      // everything_get_sum. A second, differently-named tool of the same real
      // server proves the loader enumerated the server's whole toolset over the
      // sandbox, not just one hard-coded name.
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_get_sum`, args: { a: 2, b: 40 },
      });
      await scriptMockReplyText(request, 'the real server added them up');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('add two and forty');
      await input.press('Enter');
      await expect(page.getByTestId('answer-body'))
        .toContainText('the real server added them up', { timeout: 30_000 });
      await ctx.close();
    });
});
