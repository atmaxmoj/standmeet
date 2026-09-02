// plugin-discovery-chat.spec.ts —— C4: a plugin declared at deploy time gets discovered by
// core and called by the AI inside visitor chat. This is the end-to-end proof that "core
// discovers a capability that isn't hardcoded (not MustRegister) and wasn't registered by
// the owner at runtime".
//
// Difference from external-mcp-tools.spec.ts: that test has the **owner** register via
// mcp_server_create; this test has **no owner registration action at all** — the plugin is
// declared in the deployment's STANDMEET_PLUGINS config (builtin / compose-loaded,
// infra/dev-plugins.json), pointing at mcp-server-mock (echo/boom). The visitor's role only
// **grants** this platform plugin id (ACL via role, the same mechanism as booking); the
// owner never registers any MCP server.
//
// UI-driven: relies on the persistent signal that answer-body contains the marker (the
// throbber is transient, not wagered on here).

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'plug@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'plug',
  fullName: 'Plug Owner',
};

const EXT_MARKER = '[EXT-MCP-MARKER]';
// Tool exposed by the platform plugin "echoer", named by convention <pluginid>_<tool>
// (locked in by the C4 implementation).
const PLUGIN_ID = 'echoer';

// pluginCode — the code issued in beforeAll whose role grants echoer (randomly generated,
// captured for reuse).
let pluginCode = '';

test.describe('platform-declared plugin discovered + used in visitor chat (no owner registration)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // Key point: the role grants the platform plugin id 'echoer' (granted_skills →
    // role.AllowedTools). The owner never registers any MCP server — the plugin capability
    // comes from deployment config, not from the owner.
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'plug', granted_skills: [PLUGIN_ID],
    });
    pluginCode = issued.code;
    await request.dispose();
  });

  test('AI 调到装机声明的插件工具 → 回包 marker 进 answer（core 发现了非 MustRegister 的能力）',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, { name: 'echoer_echo', args: { text: 'hi' } });
      const replyTag = await scriptMockReplyText(request, `the plugin said ${EXT_MARKER}:hi`);
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`use the plugin${toolTag}${replyTag}`);
      await input.press('Enter');

      // Persistent signal: answer-body contains the plugin's reply marker — proof that core
      // actually discovered and dialed into this config-declared plugin, with the owner
      // never registering any MCP server.
      await expect(page.getByTestId('answer-body'))
        .toContainText(EXT_MARKER, { timeout: 20_000 });
      await ctx.close();
    });

  // error-stream + end-to-end degradation: a mid-turn plugin tool failure → backend folds it
  // into errJSON → the AI still gives a friendly reply after receiving it → chat doesn't
  // crash and never leaks a stack trace.
  test('插件工具中途失败 → chat 仍友好作答（折叠错误 + 端到端降级）',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, { name: 'echoer_boom', args: {} });
      const replyTag = await scriptMockReplyText(request, 'sorry, I could not run that just now');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`use the broken plugin tool${toolTag}${replyTag}`);
      await input.press('Enter');

      await expect(page.getByTestId('answer-body'))
        .toContainText('could not run that', { timeout: 20_000 });
      await ctx.close();
    });
});
