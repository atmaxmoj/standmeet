// connector-agent-tool-names.spec.ts —— F-C-58：暴露给访客 AI 的工具名必须是 provider 收得下的。
//
// 邻居 spec（connector-agent-tools）里每一份样本 spec 的 operationId 都是 `contacts.list`
// 这种点号形状，而点号恰好是唯一被处理过的那个字符。真世界里 GitHub 整套 REST 的
// operationId 是 `gists/list` / `repos/create-for-authenticated-user` —— **带斜杠**。
//
// provider 对 `tools[].name` 的约束是 `^[a-zA-Z0-9_-]+$`，而且**整个数组一起拒**：
// 一条不合法，这一轮所有工具（订会、检索、发信）都不进模型。也就是说 owner 传进来
// 一个这样的连接器，这台实例上每个访客会话的每一把工具当场全废 —— 而触发点是一个
// 局部的、看起来无害的动作。prod 上真发生过：访客拿到的答案是一行
// `<tool_calls> github-gists </tool_calls>`。
//
// 替身网关现在按同一条规矩收名字（mock-stack/llm-gateway/toolnames.go）——
// 以前它什么名字都收，所以「产品发出去的名字合不合法」整套 e2e 从来没量过一次。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  AGENT_OWNER, MOCK_OAUTH2_SCHEME, createAndConnect, diagAgentCall,
  initOwner, sessionToolSpecs, startSession,
} from '@/fixtures/connector-agent-rig';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';

test.use({ ownerCredentials: { email: AGENT_OWNER.email, password: AGENT_OWNER.password } });

const SLASH_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Vendor With Slashes', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/crm' }],
  paths: {
    '/contacts': {
      get: {
        operationId: 'contacts/list',
        summary: 'List contacts',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'contacts' } },
      },
    },
  },
  // 鉴权跟已绿的样本共用一份 —— 这条用例考的是**名字**，连接那一段换了花样的话，
  // 红会落在鉴权上而不是落在名字上。
  components: { securitySchemes: MOCK_OAUTH2_SCHEME },
} as const;

// provider 对工具名的字符集。断言和替身网关是同一条规矩。
const PROVIDER_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

// 授权清单不是这条用例要考的东西：未修的代码算出 `op_contacts/list`，修好的算出
// `op_contacts_list`。两个都授，红才落在名字本身上，而不是落在「这个 op 没被暴露」。
const SLASH_OP_GRANTS = ['op_contacts/list', 'op_contacts_list'] as const;

test.describe('connector · agent-tool names must be provider-legal (F-C-58)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('an operationId with a slash still yields a callable tool — and does not poison the turn',
    async () => {
      const id = await createAndConnect(
        request, csrf, { spec: SLASH_SPEC, expose_as_agent_tools: true },
      );
      const session = await startSession(request, csrf, SLASH_OP_GRANTS);
      const specs = await sessionToolSpecs(request, session.session_token);
      const exposed = specs.map((t) => t.name).filter((n) => n.startsWith('op_'));

      // ① 名字要过 provider 那一关。这是缺陷本身。
      expect(exposed.length, 'the slashed operation is exposed at all').toBe(1);
      expect(exposed[0], 'exposed tool name is legal for the provider')
        .toMatch(PROVIDER_TOOL_NAME);

      // ② 改了名字不许把派发弄丢：原始 operationId 仍要打得到 SaaS。
      expect(await diagAgentCall(request, csrf, id, 'contacts/list', {}),
        'the original operationId still dispatches').toBe(200);

      // ③ 这一轮要真的答出话来。未修时 provider 拒掉整个数组，救场那一步把模型吐的
      //    `<tool_calls>` 标记当成答案端给访客（prod 上就是这样）。
      const tag = await scriptMockToolCall(request, { name: exposed[0]!, args: {} });
      const answer = await runVisitorChatTurn(request, session, `List the contacts${tag}`);
      expect(await answer.text(), 'the visitor is not shown tool-call markup')
        .not.toContain('<tool_calls>');
    });
});
