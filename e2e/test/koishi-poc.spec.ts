// koishi-poc.spec.ts — item 28: a REAL third-party Koishi plugin, used by a visitor agent, for real.
//
// infra/plugins/koishi is our stdio-MCP wrapper (koishi-mcp.js) that boots Koishi headlessly
// (@koishijs/plugin-mock) and loads koishi-plugin-base64 (by windbullet, MIT) unchanged. Its tools
// (base64_encode / base64_decode) return whatever the Koishi plugin computes — nothing in StandMeet
// reimplements base64. So a correct result end to end proves a plugin from a different ecosystem runs
// as a StandMeet block, over the same sandbox_stdio path as any third-party MCP server (mirrors
// real-third-party-mcp-loader.spec.ts).
//
// Rigged-test-safe: the test feeds only the INPUT ("hello" / the ciphertext). The value the plugin
// COMPUTES is echoed back into the reply (koishi_ is in the gateway's echoToolPrefixes) and asserted
// in the answer — it can only appear if the real Koishi tool ran and returned it. The scripted final
// reply also renders only if the tool dispatched through the bwrap sandbox without breaking the turn.
//
// RED until infra/dev-plugins.json declares `koishi` and provision.sh installs its node_modules.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'koishi@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'koishi',
  fullName: 'Koishi POC Owner',
};

// Declared in infra/dev-plugins.json; tools surface prefixed <id>_<tool>.
const PLUGIN_ID = 'koishi';

let pluginCode = '';

test.describe('REAL third-party Koishi plugin (koishi-plugin-base64) — used by a visitor agent', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'koishi', granted_skills: [PLUGIN_ID],
    });
    pluginCode = issued.code;
    await request.dispose();
  });

  test('base64_encode: the Koishi plugin computes the encoding and it reaches the visitor',
    async ({ browser, playwright }) => {
      // Koishi is a heavyweight framework: the first sandbox spawn cold-`require`s a 174-package
      // node_modules tree under bwrap (~15-20s), so the first turn is far slower than a lean MCP
      // server. Give the turn room; the default 30s test budget can't fit a cold koishi turn.
      test.setTimeout(120_000);
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_base64_encode`, args: { text: 'hello' },
      });
      const replyTag = await scriptMockReplyText(request, 'the koishi plugin encoded it');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`encode hello${toolTag}${replyTag}`);
      await input.press('Enter');
      // The scripted reply renders only if the real Koishi tool dispatched through the sandbox.
      await expect(page.getByTestId('answer-body'))
        .toContainText('the koishi plugin encoded it', { timeout: 90_000 });
      // The value the REAL plugin computed, echoed into the answer. The test fed "hello", never
      // "aGVsbG8=": base64("hello") == "aGVsbG8=" is Koishi's output, not ours.
      await expect(page.getByTestId('answer-body')).toContainText('aGVsbG8=');
      await ctx.close();
    });

  test('base64_decode: a second tool of the same real server also loads and computes',
    async ({ browser, playwright }) => {
      test.setTimeout(120_000); // cold koishi sandbox spawn — see the note in the encode test
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_base64_decode`, args: { text: 'aGVsbG8=' },
      });
      const replyTag = await scriptMockReplyText(request, 'the koishi plugin decoded it');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`decode it${toolTag}${replyTag}`);
      await input.press('Enter');
      await expect(page.getByTestId('answer-body'))
        .toContainText('the koishi plugin decoded it', { timeout: 90_000 });
      // The test fed the ciphertext "aGVsbG8="; the decoded "hello" is the plugin's output.
      await expect(page.getByTestId('answer-body')).toContainText('解码结果为：hello');
      await ctx.close();
    });
});
