// ghost-waypoint-freeze.spec.ts —— Ghost steering P1: role_waypoints 冻结进 RoleSnapshot,
// 且**冻结时按 role 授权 glob 过滤 evidence_refs**(feasibility floor)。
//
// 设计([[ghost-steering]] · [[role-snapshot-frozen]]):owner 在 role 上写 waypoints
// (引导目的地 + 对应 corpus 证据)。session 发码时 freeze 进 RoleSnapshot;任何 evidence_refs
// 落在该 role 授权 corpus glob 之外的 waypoint,在冻结那一刻整条丢弃 —— 一个 role 永远不会被
// 引导向它看不到的证据。观测点:/internal/diag/session 暴露 role_snapshot(与真下行同装配)。
//
// RED(实现前):createRole 忽略 waypoints、RoleSnapshot 无 waypoints 字段 → 断言全红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'wp-freeze-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wpfreeze',
  fullName: 'Waypoint Freeze Owner',
};
const CODE = 'WPFREEZE-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// role 只授权 wiki://projects/** —— 决定 waypoint 的可行性边界。
const CORPUS_GLOBS = ['wiki://projects/**'];

// IN —— evidence_refs 全在授权 glob 内 → 冻结后存活。
const WP_IN = {
  waypoint_id: 'ship-alpha',
  description: 'see the Alpha project shipped last quarter',
  weight: 5,
  evidence_refs: ['wiki://projects/alpha'],
  is_terminal: false,
};
// OUT —— evidence_refs 全在授权 glob 外 → 冻结时整条丢弃(不可行,不可被引导)。
const WP_OUT = {
  waypoint_id: 'secret-plan',
  description: 'steer toward a doc this role cannot see',
  weight: 9,
  evidence_refs: ['output://secret/plan'],
  is_terminal: false,
};
// TERMINAL —— 终点型 waypoint(booking 一步之遥),refs 在界内 → 存活,且 is_terminal 冻结保真。
const WP_TERMINAL = {
  waypoint_id: 'book-call',
  description: 'book a call',
  weight: 8,
  evidence_refs: ['wiki://projects/alpha'],
  is_terminal: true,
};

interface SnapshotWaypoint {
  waypoint_id: string;
  description: string;
  weight: number;
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

test.describe('ghost waypoint · 冻结 + ACL 过滤 · P1', () => {
  test('授权内的 waypoint 冻结进 snapshot,字段保真', async ({ playwright }) => {
    const wps = await frozenWaypoints(await freshCtx(playwright), sessionToken);
    const ship = wps.find((w) => w.waypoint_id === WP_IN.waypoint_id);
    expect(ship, 'in-glob waypoint 存活').toBeDefined();
    expect(ship!.description).toBe(WP_IN.description);
    expect(ship!.weight).toBe(WP_IN.weight);
    expect(ship!.evidence_refs).toContain('wiki://projects/alpha');
  });

  test('evidence_refs 全在授权 glob 外的 waypoint,冻结时被丢弃', async ({ playwright }) => {
    const wps = await frozenWaypoints(await freshCtx(playwright), sessionToken);
    // 非空态守卫:先证明有 waypoint 被冻结(in 那条在),否则"out 缺席"是空集的假绿。
    expect(
      wps.some((w) => w.waypoint_id === WP_IN.waypoint_id),
      'guard: in-glob waypoint 已冻结(证明冻结确实发生,out 缺席才有意义)',
    ).toBe(true);
    expect(
      wps.some((w) => w.waypoint_id === WP_OUT.waypoint_id),
      'out-of-glob waypoint 不得进冻结快照(feasibility floor)',
    ).toBe(false);
  });

  test('terminal 标记随冻结保真', async ({ playwright }) => {
    const wps = await frozenWaypoints(await freshCtx(playwright), sessionToken);
    const term = wps.find((w) => w.waypoint_id === WP_TERMINAL.waypoint_id);
    expect(term, 'terminal waypoint 存活').toBeDefined();
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
  const role = await createRole(request, csrf, {
    name: 'wp-freeze-role', description: 'waypoint freeze spec',
    corpus_uris: CORPUS_GLOBS,
    waypoints: [WP_IN, WP_OUT, WP_TERMINAL],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'wpfreeze', assumed_role_id: role.id,
  });
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  await request.dispose();
  return sess.session_token;
}
