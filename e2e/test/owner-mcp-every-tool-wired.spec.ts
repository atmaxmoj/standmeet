// owner-mcp-every-tool-wired.spec.ts — [external] **every single** owner MCP tool is
// actually wired up.
//
// Why this test is needed:
//
// norm-outward-toolset pins down all 127 tool names verbatim, but that's tools/**list**
// — it only proves "the tool can be declared", not "it can be called". An audit
// found: of 127 tools, e2e had genuinely called only 32 (25%); the other ~95 had
// never been invoked. The gap between declaration and implementation is exactly the
// blind spot nobody was watching.
//
// That gap is precisely the most dangerous place when splitting ownercore back apart
// into per-domain facades: a binding moves from one package to another, **the name
// and schema stay identical while the dependency injection gets dropped** (the deps
// field never got wired → the handler holds nil). tools/list still lists it fine,
// the golden test still goes green, until the day the owner actually calls it and it
// panics.
// This exact shape has already bitten once: when the booker was externalized, only
// Gate got backfilled into Gate/State, while the contract kept promising
// quota_remaining.
//
// The criterion: call every tool once with empty args {}, and require
//   (1) HTTP 200 with a valid JSON-RPC result;
//   (2) not a JSON-RPC error (which would mean the tool was never registered at all);
//   (3) the result is not the panic marker (PANIC_MARKER).
// A tool returning an ordinary isError ("missing field xxx") **counts as a pass** —
// that's exactly what proves the gate, the dependency, and the validation are all
// running.
// Empty args are deliberate: they make every tool stop right at its own parameter
// validation, covering every tool without actually mutating any data.
//
// (3) is the linchpin of this test, and before writing it I first proved it could go
// red: I injected nil into wire_owner_mcp's PageContent (exactly the shape of "a
// binding moved and its dependency never got wired"), and page.get/page.put did
// panic — yet at the time this test **was green**. Because the adapter's recover
// only logged and never set a return value, the function returned (nil, nil), the
// client received "success but empty", and a crash looked identical to "there was
// simply no output". That swallowed exception is now fixed (a panic now returns an
// error carrying a marker), which is what makes there something to assert here at
// all. A guard only earns the name once it's proven it can actually go red.
//
// Adding/removing an owner tool needs no change here (it pulls the list live from
// tools/list); it only goes red when some specific tool can't be reached.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callToolOutcome, initMCP, listTools } from '@/fixtures/mcp';

const OWNER = {
  email: 'every-tool-wired@example.com', password: 'correct-horse-battery-staple',
  handle: 'everytoolwired', fullName: 'Every Tool Wired Owner',
};

// The list must have at least this many tools to count as real (guards against
// tools/list degrading to an empty table and still reading as "all green").
const minExpectedTools = 100;

// PANIC_MARKER — must match the backend's mcphandle.PanicResultMarker verbatim.
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
