// owner-mcp-every-tool-wired.spec.ts —— 【对外】**每一个** owner MCP 工具都真的接通了。
//
// 为什么需要这条:
//
// norm-outward-toolset 把 127 个工具名逐字钉死,但那是 tools/**list** —— 它只证明"工具
// 声明得出来",不证明"调得动"。审计过一次:127 个工具里 e2e 真正 call 过的只有 32 个
// (25%),另外 ~95 个从来没被调用过。声明和实现之间那道缝就是没人看的地方。
//
// 这道缝正是把 ownercore 拆回各域 facade 时最危险的地方:绑定从一个包挪到另一个包,
// **名字和 schema 原样保留、依赖注入却掉了**(deps 字段没接上 → handler 里是 nil)。
// tools/list 照样把它列出来,golden 照样绿,直到某天 owner 真去调它才 panic。
// 已经踩过一次同型的:booker 外置时 Gate/State 只补回 Gate,契约还在承诺 quota_remaining。
//
// 判据:每个工具都用空入参 {} 调一次,要求
//   ① HTTP 200 且拿到合法 JSON-RPC result;
//   ② 不是 JSON-RPC error(那意味着工具压根没注册);
//   ③ 结果不是 panic 标记(PANIC_MARKER)。
// 工具自己返回普通 isError("缺 xxx 字段")**算通过** —— 那恰恰证明门在、依赖在、校验在跑。
// 空入参是故意的:它让每个工具走到自己的参数校验就停住,既覆盖全部工具,又不会真的改数据。
//
// ③ 是这条测试的命门,写它之前先证过它会红:把 wire_owner_mcp 的 PageContent 注成 nil
// (完全就是"绑定搬家依赖没接上"的样子),page.get/page.put 确实 panic 了 —— 而当时这条
// 测试**是绿的**。因为 adapter 的 recover 只 log 不赋返回值,函数返回 (nil,nil),客户端
// 收到"成功但空",崩溃和"本来就没输出"长得一样。那个吞异常已经修掉(panic 现在回一条带
// 标记的错误),这里才有东西可断言。守卫得先能红,才配叫守卫。
//
// 加/删 owner 工具不需要改这条(它从 tools/list 现拿清单);它只会在"某个工具接不通"时红。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callToolOutcome, initMCP, listTools } from '@/fixtures/mcp';

const OWNER = {
  email: 'every-tool-wired@example.com', password: 'correct-horse-battery-staple',
  handle: 'everytoolwired', fullName: 'Every Tool Wired Owner',
};

// 至少要有这么多工具才算清单是真的(防止 tools/list 退化成空表还"全绿")。
const minExpectedTools = 100;

// PANIC_MARKER —— 必须跟后端 mcphandle.PanicResultMarker 逐字一致。
const PANIC_MARKER = 'internal error: capability handler panicked';

test.describe('owner MCP · 每个工具都接通(不只是列得出来)', () => {
  let token = '';
  let sid = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'every-tool-wired');
    sid = await initMCP(request, token);
    await request.dispose();
  });

  test('tools/list 上的每个工具都能被调用(空入参 → 干净的校验错,而不是打不通)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const tools = await listTools(request, token, sid);
      expect(tools.length,
        `tools/list 只返回 ${tools.length} 个工具 —— 清单本身可疑,先查 owner MCP 是否退化`)
        .toBeGreaterThanOrEqual(minExpectedTools);

      const broken: string[] = [];
      for (const t of tools) {
        const out = await callToolOutcome(request, token, sid, t.name, {});
        if (!out.reachable || out.rpcError !== '') {
          broken.push(`${t.name}: 打不通 (status=${out.status} rpc_error=${out.rpcError || '-'})`);
          continue;
        }
        if (out.text.includes(PANIC_MARKER)) {
          broken.push(`${t.name}: handler panic(依赖没接上?) — ${out.text}`);
        }
      }
      await request.dispose();

      expect(broken,
        `这些 owner MCP 工具列得出来却用不了 —— 多半是绑定搬家时依赖没接上:\n` +
        broken.join('\n'))
        .toEqual([]);
    });
});
