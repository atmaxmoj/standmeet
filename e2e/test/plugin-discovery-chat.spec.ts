// plugin-discovery-chat.spec.ts —— C4: 装机声明的插件,被 core 发现并在 visitor
// chat 里被 AI 调到。这是「core 发现了它没写死(非 MustRegister)、也非 owner 运行时
// 注册的能力」的端到端主证。
//
// 跟 external-mcp-tools.spec.ts 的区别:那条是 **owner** 用 mcp_server_create 注册;
// 这条**没有任何 owner 注册动作** —— 插件由部署在 STANDMEET_PLUGINS 配置里声明
// (builtin / compose 装载,infra/dev-plugins.json),指向 mcp-server-mock(echo/boom)。
// 访客的 role 只是**授权**了这个平台插件 id(ACL via role,跟 booking 一套),
// owner 没注册任何 MCP server。
//
// UI-driven:走持久信号 answer-body 含 marker(throbber 瞬时,不在此赌)。

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
// 平台插件 "echoer" 暴露的工具,命名约定 <pluginid>_<tool>(C4 实现锁定)。
const PLUGIN_ID = 'echoer';

// pluginCode —— beforeAll 里发的、role 授权了 echoer 的 code(随机生成,捕获复用)。
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
    // 关键:role 授权了平台插件 id 'echoer'(granted_skills → role.AllowedTools)。
    // owner 全程没注册任何 MCP server —— 插件能力来自装机配置,不来自 owner。
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'plug', granted_skills: [PLUGIN_ID],
    });
    pluginCode = issued.code;
    await request.dispose();
  });

  test('AI 调到装机声明的插件工具 → 回包 marker 进 answer（core 发现了非 MustRegister 的能力）',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, { name: 'echoer_echo', args: { text: 'hi' } });
      await scriptMockReplyText(request, `the plugin said ${EXT_MARKER}:hi`);
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('use the plugin');
      await input.press('Enter');

      // 持久信号:answer-body 含插件回包 marker —— 证明 core 真的发现 + 拨通了这个
      // 配置声明的插件,且 owner 全程没注册任何 MCP server。
      await expect(page.getByTestId('answer-body'))
        .toContainText(EXT_MARKER, { timeout: 20_000 });
      await ctx.close();
    });

  // error-stream + 端到端降级：插件工具中途失败 → backend 折成 errJSON →
  // AI 拿到后仍给出友好回答 → chat 不崩、不露 stack trace。
  test('插件工具中途失败 → chat 仍友好作答（折叠错误 + 端到端降级）',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, { name: 'echoer_boom', args: {} });
      await scriptMockReplyText(request, 'sorry, I could not run that just now');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('use the broken plugin tool');
      await input.press('Enter');

      await expect(page.getByTestId('answer-body'))
        .toContainText('could not run that', { timeout: 20_000 });
      await ctx.close();
    });
});
