// ghost-waypoint-resolvable.spec.ts —— F-A-26: 冻结那一刻的可行性下限必须看**被指的东西在不在**,
// 不能只看**指的那串字写没写**。
//
// 设计([[ghost-steering]] §Per-clause basis):evidence gate 的依据是 "a ghost pointing where the
// corpus is thin steers the conversation into a failure"。一条解析不出任何笔记的 evidence_ref 就是
// 最薄的那种薄 —— 而它能同时穿过两道现有的闸:
//   • FilterWaypointsByCorpus 只判 ref 落不落在授权 glob 内(wiki://never-written 匹配 wiki://** 匹配得很好);
//   • require_ghost_evidence 只判 len(evidence_refs) > 0。
//
// 而它比「压根没写 refs」更糟:WaypointLedger 是拿 refs 去比对**本轮真被引用的笔记**推出的 URI 来标
// visited 的,所以一条指向空的 ref 永远不可能被任何引用命中 —— 这条 waypoint **永久不可访**,ghost
// 每轮都会重新推它,而「所有 waypoint 到访后转静默」在这个 role 上永远无法满足。
//
// RED(修复前):phantom 那条照样进冻结快照 —— 第二个 test 红。
//
// 「零 refs」不在本 spec 范围内:那一类由 require_ghost_evidence 这个旋钮管,开关是 owner 的选择。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'wp-reach-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wpreach',
  fullName: 'Waypoint Reachable Owner',
};
const CODE = 'WPREACH-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// role 授权整个 wiki —— 三条 waypoint 的 refs 全部在授权 glob 内。分开它们的**只有**「笔记在不在」,
// 授权那一层在本 spec 里被刻意调成看不出差别,好让它证明的是可行性而不是授权。
const CORPUS_GLOBS = ['wiki://**'];

// 真证据:这条笔记下面会被 seed 出来。title 'Alpha' + path 'alpha' → URI wiki://alpha。
const REAL_TITLE = 'Alpha';
const REAL_PATH = 'alpha';
const WP_REAL = {
  waypoint_id: 'read-alpha',
  description: 'read the Alpha note',
  weight: 5,
  evidence_refs: ['wiki://alpha'],
  is_terminal: false,
};

// 空证据:glob 合法、语法合法、指向不存在。prod 上 read-standpoint → subjectivity://standpoint
// 就是这一条的真身。
const WP_PHANTOM = {
  waypoint_id: 'read-standpoint',
  description: 'read the standpoint note',
  weight: 9,
  evidence_refs: ['wiki://standpoint-that-was-never-written'],
  is_terminal: false,
};

// 终点 + 空证据:必须**存活**。终点靠工具事件(约成)标 visited,不靠引用,所以它的 ref 解不解析得出来
// 都不影响它可达。这条守的是修复不许过头 —— 把预约终点滤掉会让整条转化路径静音。
const WP_TERMINAL = {
  waypoint_id: 'book-call',
  description: 'book a call',
  weight: 8,
  evidence_refs: ['wiki://also-never-written'],
  is_terminal: true,
};

interface SnapshotWaypoint {
  waypoint_id: string;
  evidence_refs: string[];
  is_terminal: boolean;
}

async function frozenWaypoints(
  request: APIRequestContext, sessionToken: string,
): Promise<SnapshotWaypoint[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  expect(res.status(), 'diag/session 200').toBe(200);
  const body = await res.json() as { waypoints?: SnapshotWaypoint[] };
  return body.waypoints ?? [];
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let sessionToken = '';

test.beforeAll(async ({ playwright }) => {
  sessionToken = await setup(playwright);
});

test.describe('ghost waypoint · 可行性下限要解析得出证据 · F-A-26', () => {
  test('证据解析得出的 waypoint 冻结进 snapshot', async ({ playwright }) => {
    const wps = await frozenWaypoints(await freshCtx(playwright), sessionToken);
    const real = wps.find((w) => w.waypoint_id === WP_REAL.waypoint_id);
    expect(real, '指向真实笔记的 waypoint 必须存活').toBeDefined();
    expect(real!.evidence_refs, '证据 ref 冻结保真').toContain('wiki://alpha');
  });

  test('证据全解析不出的非终点 waypoint,冻结时被丢弃', async ({ playwright }) => {
    const wps = await frozenWaypoints(await freshCtx(playwright), sessionToken);
    // 非空态守卫:先证明冻结确实发生了(真的那条在),否则「phantom 缺席」可能只是空集的假绿。
    expect(
      wps.some((w) => w.waypoint_id === WP_REAL.waypoint_id),
      'guard: 真 waypoint 已冻结(证明冻结发生,phantom 缺席才有意义)',
    ).toBe(true);
    expect(
      wps.some((w) => w.waypoint_id === WP_PHANTOM.waypoint_id),
      '证据指向不存在笔记的非终点 waypoint 不得进冻结快照 —— 它永久不可访,'
      + '会让 ghost 永远推它、永远静默不下来',
    ).toBe(false);
  });

  test('终点 waypoint 不因证据解析不出而被丢弃', async ({ playwright }) => {
    const wps = await frozenWaypoints(await freshCtx(playwright), sessionToken);
    const term = wps.find((w) => w.waypoint_id === WP_TERMINAL.waypoint_id);
    expect(
      term,
      '终点靠工具事件标 visited 而非引用,证据解不出也仍然可达,必须存活',
    ).toBeDefined();
    expect(term!.is_terminal, 'is_terminal 冻结保真').toBe(true);
  });
});

async function freshCtx(playwright: Playwright): Promise<APIRequestContext> {
  return await playwright.request.newContext();
}

async function setup(playwright: Playwright): Promise<string> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // 先 seed 真证据,再发码 —— 冻结那一刻它必须已经在库里,否则「存活」那条会因为时序而假红。
  const apiToken = await createAPIToken(request, csrf, 'wpreach-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: REAL_TITLE, body: 'Alpha shipped last quarter.', path: REAL_PATH,
  });
  const role = await createRole(request, csrf, {
    name: 'wp-reach-role', description: 'waypoint resolvability spec',
    corpus_uris: CORPUS_GLOBS,
    waypoints: [WP_REAL, WP_PHANTOM, WP_TERMINAL],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'wpreach', assumed_role_id: role.id,
  });
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  await request.dispose();
  return sess.session_token;
}
