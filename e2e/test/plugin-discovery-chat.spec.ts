// plugin-discovery-chat.spec.ts —— C4: 装机声明的插件,被 core 发现并在 visitor
// chat 里被 AI 调到。这是「core 发现了它没写死(非 MustRegister)、也非 owner 运行时
// 注册的能力」的端到端主证。
//
// 跟 external-mcp-tools.spec.ts 的区别:那条是 **owner** 用 mcp_server_create 注册;
// 这条**没有任何 owner 注册动作** —— 插件由部署在 STANDMEET_PLUGINS 配置里声明
// (builtin / compose 装载),指向 docker-compose 起的 mcp-server-mock(echo tool)。
//
// C0 阶段红:dev 栈还没把 mock 当 builtin 插件装载(C4 wire docker-compose +
// 装载器);wire 完转绿。dial 失败的降级在 C2/C3 单测(ErrHidden)已覆盖。
//
// UI-driven:走持久信号 answer-body 含 marker(throbber 瞬时,不在此赌)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'plug@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'plug',
  fullName: 'Plug Owner',
};

const CODE = 'PLUG-001';
const EXT_MARKER = '[EXT-MCP-MARKER]';
// 平台插件 "echoer" 暴露的工具,命名约定 <pluginid>_<tool>（C4 实现锁定）。
const PLUGIN_TOOL = 'echoer_echo';

test.describe('platform-declared plugin discovered + used in visitor chat (no owner registration)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issuePlainCode(request);
    await request.dispose();
  });

  test('AI 调到装机声明的插件工具 → 回包 marker 进 answer（core 发现了非 MustRegister 的能力）',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // 让 mock LLM 这一轮调那个平台插件的工具,再用回包文本作答。
      await scriptMockToolCall(request, { name: PLUGIN_TOOL, args: { text: 'hi' } });
      await scriptMockReplyText(request, `the plugin said ${EXT_MARKER}:hi`);
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
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
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('use the broken plugin tool');
      await input.press('Enter');

      await expect(page.getByTestId('answer-body'))
        .toContainText('could not run that', { timeout: 20_000 });
      await ctx.close();
    });
});

// issuePlainCode —— 普通 role + code,**不挂任何 owner MCP server**;插件能力来自
// 平台装载,不来自 owner 注册 —— 这正是要证的点。
async function issuePlainCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'plug-role', description: 'plugin discovery spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'plug', assumed_role_id: role.id });
}
