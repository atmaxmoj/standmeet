// norm-outward-toolset.spec.ts —— 【对外】自管理 MCP handles 的 **tools/list 工具面
// golden**(真实 MCP 客户端发现路径)。
//
// 这条守的是 owner 用真实 MCP 客户端(Claude Desktop / Cursor)连进来时,tools/list
// 实际返回的工具清单。它跟 norm-outward-handles.spec.ts(走 diag/registry 看 capability
// id)是**两条不同的路径**:
//   - registry 那条:能力注册对不对(进程内视角)。
//   - 这条:工具被序列化、经 HTTP 传输、被客户端发现 —— **能不能真用起来**。
//
// 为什么单列:tools/list 会把**全部**工具的 InputSchema 一次性 marshal。任何一个工具
// 的 InputSchema 是坏 JSON,整张表 marshal 失败 → 返空 body → 客户端一个工具都发现不
// 了(owner MCP 整个不可用)。这正是历史上真实发生过的 bug(skill_create 的 schema 在
// backtick 原始串里误用了 Go 字符串拼接 `"+`)。Go 侧有 schema_valid_test 兜底,这条在
// e2e 把"真客户端能发现完整工具面"钉死。
//
// golden = 全部 owner_only 工具(内建 126 + jobs 插件 10 + 连接器 manifest 声明的 1 = 137)。
// 加/删 owner 工具时这条会红 —— 那是**有意**的:逼你同步更新工具面预期。
//
// **owner 工具有三个来源**,不是两个:host 侧写死的、能力插件的、以及**连接器 manifest 里的
// `owner_ops:`**。第三个来源是后加的(F-C-16 的 connectors.calendar_check),而那次没更新这份
// golden —— 于是这条从那时起一直红着,直到手工驱 owner-mcp 数了一遍工具才被发现。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, listTools } from '@/fixtures/mcp';

const OWNER = {
  email: 'norm-toolset@example.com', password: 'correct-horse-battery-staple',
  handle: 'normtoolset', fullName: 'Norm Toolset Owner',
};

// GOLDEN —— tools/list 必须逐字返回这 136 个 owner 工具(排序后比,顺序噪声由 mcp-go
// 注册顺序决定、不在本条职责内)。facade-parity 全额付清后(56→0):每个 admin 面的
// owner 能力都有一个 owner-MCP 孪生工具。新增/删除 owner 工具必须同步更新本 golden。
const GOLDEN_TOOLSET: readonly string[] = [
  // me / seo / codes
  'me',
  // wiki / output 合成一个 op（genre 是参数）——面板早就是一条路由。
  'seo.set_entry_seo', 'seo.update_settings',
  'seo.get_settings', 'seo.stats',
  'codes.create', 'codes.revoke', 'codes.update_quotas',
  'codes.list', 'codes.list_members',
  'codes.list_denials', 'codes.add_denial', 'codes.remove_denial',
  // 这四条以前只有面板有（waypoints 读写 / ghost-evidence / corpus 收回整份），
  // 既没有 MCP 孪生也没进台账。搬进收口之后两个面同时欠它们。
  'codes.set_corpus_denials', 'codes.set_ghost_evidence',
  'codes.waypoints', 'codes.set_waypoints',
  // corpus —— genre 是**参数**,不是三套工具:归一化前这里是 11 个工具
  // (raw_dump / list_recent_{raw,wiki,output} / update_{wiki,output} /
  //  delete_{wiki,output} / promote_to_wiki / promote_wiki_to_output / corpus_get_entry),
  // 而且 MCP 上建不了 wiki、改不了 raw —— 那四个格子是收成一个参数之后自动补齐的。
  'subjectivity_write',
  'corpus.list', 'corpus.get',
  'corpus.create', 'corpus.update', 'corpus.delete', 'corpus.promote',
  // check_i18n —— 多语结构只看不写。owner 的 AI 在写一条带 `> [!i18n]` 的笔记之前先问一次,
  // 拿到的诊断跟 corpus.create 拒绝时用的是同一份(两处各判一套的话,"检查过了却写不进去"
  // 迟早发生,而 agent 只会重试)。
  'corpus.check_i18n',
  // 素材 —— **任意 genre** 都能挂图 / 附件 / hero。以前挂图只有一条路(写一篇 writing 时
  // 把内联图地址跟表单一起交上去),于是"素材"不是一件独立的事,一条 raw 想配张图没有说法。
  // 现在它是独立一步:先 assets.upload 拿 id,再在正文里引 standmeet-asset:<id>,或设成 hero 图。
  // assets.delete —— 传错一份得撤得下来。只有"挂上去"没有"撤下来"的话,owner 唯一的补救
  // 是连整条语料一起删。
  'assets.upload', 'assets.delete',
  // chat / conversations / prompts / roles
  // 一份逐字稿两个面同一份载荷之后,读它的 op 就叫 conversations.get
  // (原 chat.show_grounding 只是 MCP 那份的名字)。
  'conversations.list', 'conversations.get', 'conversations.ghost_telemetry',
  'prompt_create', 'prompt_list', 'prompt_delete', 'prompt_update', 'prompts.get',
  // providers —— owner 的 provider 本子。**没有 providers.create**:建一条要带原始 API key,
  // 而 MCP 是纯 JSON 工具面,不承载密钥(跟 ai_provider.set 同一个理由,见 owner/ops)。
  // 列 / 改 / 标默认 / 删都不碰密钥,所以两个面都给。
  'providers.list', 'providers.update', 'providers.set_default', 'providers.delete',
  'role_create', 'role_list', 'role_delete', 'role_update', 'roles.get',
  'roles.set_dock_buttons',
  // mcp servers / skills / capabilities
  // mcp_server_check —— 注册完之后唯一能问的一句:那台 server 答不答话、有哪些工具。
  // 没有它,一行 ext-MCP 上的证据只有 owner 自己粘进去的那个 URL(F-D-8)。
  'mcp_server_create', 'mcp_server_list', 'mcp_server_check', 'mcp_server_delete',
  'mcp_server_grant_dep',
  'skill_create', 'skill_list', 'skill_delete', 'skill_set_enabled',
  'capabilities.list', 'capabilities.set_enabled', 'capabilities.delete',
  // writings
  // save 还是 writing_create(multipart 那半边没搬,见 res_writings.go 的说明);
  // 其余四个搬进收口后按资源统一叫 writings.*。
  'writing_create',
  'writings.list', 'writings.publish', 'writings.unpublish', 'writings.delete',
  // custom page
  'custom_page.create', 'custom_page.list', 'custom_page.get_build',
  'custom_page.write_file', 'custom_page.build', 'custom_page.delete',
  'custom_page.promote_to_staging', 'custom_page.promote_to_live',
  'custom_page.rollback',
  // page / calendar / booking / appearance
  'page.get', 'page.put', 'page.set_public_url',
  'page.pin', 'page.unpin',
  // 改 handle 跟改 public URL 是同一类事(这台实例对外的地址),所以叫 set_handle
  // 而不是 update_handle;pinnable 以前只有面板有。
  'page.set_handle', 'page.pinnable',
  // booker 的三个 owner 工具都由**沙箱**提供(OwnerTools 声明,实现在它自己那儿):
  // 列表和取消曾经在 host 各有一份实现,跟沙箱那份是同一件事的不同写法。
  'calendar.list_slots', 'calendar.cancel_booking', 'bookings.list',
  'set_owner_css', 'appearance.get_css',
  // connectors
  'connectors.list', 'connectors.catalog', 'connectors.status',
  'connectors.create', 'connectors.update', 'connectors.delete',
  'connectors.activate', 'connectors.disconnect',
  'connectors.validate_spec', 'connectors.mail_test_send',
  // **第三个来源**：连接器 manifest 自己声明的 owner op（`owner_ops:`）。
  // 上面那些是 host 侧写死的；这一条住在 `backend/connectors/google-calendar/manifest.yaml`，
  // 由 F-C-16 加进来 —— 而这份 golden 当时没跟着改，于是它从那时起一直红着没人看见
  // （见 [[green-means-the-real-suite-ran]]：局部跑绿掩不住跨切面守卫的红）。
  'connectors.calendar_check',
  // access requests / ip bans / domains / instance / marketplace / ai
  'access_requests.list', 'access_requests.update', 'access_requests.approve',
  'ip_bans.list', 'ip_bans.add', 'ip_bans.remove',
  'domains.list', 'domains.add', 'domains.remove',
  // 能力的可设置项走**通用**口（capability_config.*），不再是每个能力一组写死的工具：
  // booking.get_policy / set_policy 就是那样来的，跟沙箱那份策略飘了。
  'capability_config.list', 'capability_config.get', 'capability_config.set',
  'instance.status', 'instance.inference_usage', 'instance.corpus_growth',
  // corpus_graph 是**新填的缺口**：admin 一直有 GET /stats/graph，MCP 没有孪生，
  // 而且它连手写对照表里都没有一行 —— 棘轮从来看不见它。搬进收口后两个面都欠它。
  'instance.corpus_graph',
  'instance.activity', 'instance.jobs',
  'marketplace.search', 'marketplace.install',
  'account.set_full_name', 'account.set_timezone', 'byoai.set', 'ai_provider.presets',
  // api-key facade management (facade-directions.md; MCP-first)
  'api_keys.create', 'api_keys.list', 'api_keys.revoke', 'api_keys.update',
  'api_keys.list_denials', 'api_keys.add_denial', 'api_keys.remove_denial',
  'api.open', 'api.close', 'api.list_candidates',
  // jobs plugin (jobs / resume / applications)
  'jobs.register_source', 'jobs.list_sources', 'jobs.unregister_source',
  'jobs.fetch_new', 'jobs.show', 'jobs.discard',
  'resume.draft', 'resume.update_draft', 'resume.discard_draft',
  'applications.commit',
];

let token = '';
let sid = '';

test.describe('能力归一化 · 【对外】tools/list 工具面 golden(真实客户端发现路径)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'norm-toolset');
    sid = await initMCP(request, token);
    await request.dispose();
  });

  test('tools/list 返回完整 owner 工具面(逐字等于 golden)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const names = (await listTools(request, token, sid)).map((t) => t.name).sort();
    expect(names).toEqual([...GOLDEN_TOOLSET].sort());
    await request.dispose();
  });

  // 一个能力可以在 codes 的入参上加自己的字段(booker 的 max_bookings 是第一个,走
  // access.CodeExtras)。access 域不认识它,所以没有任何编译期的东西钉住"它还在":
  // 接线断了照样绿,只是 owner 从 MCP 再也设不了预约配额。这条钉的就是那个。
  test('codes 的入参 schema 带着能力贡献的字段(max_bookings)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const tools = await listTools(request, token, sid);
    for (const name of ['codes.create', 'codes.update_quotas']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} missing from tools/list`).toBeTruthy();
      expect(
        Object.keys(tool?.inputSchema?.properties ?? {}),
        `${name} lost the capability-contributed field`,
      ).toContain('max_bookings');
    }
    await request.dispose();
  });

  test('tools/list body 非空(回归守护:坏 schema 曾让整张表返空)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const tools = await listTools(request, token, sid);
      expect(tools.length).toBeGreaterThan(0);
      // 每个工具都得有 name —— 证明序列化没被某个坏 schema 截断。
      for (const t of tools) expect(t.name).toBeTruthy();
      await request.dispose();
    });
});
