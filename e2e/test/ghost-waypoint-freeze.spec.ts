// ghost-waypoint-freeze.spec.ts — Ghost steering P1: role_waypoints freeze into
// RoleSnapshot, and **at freeze time, evidence_refs are filtered by the role's granted
// corpus glob**.
//
// This gate is about **authorization**: can this role's glob see this piece of evidence.
// It was once called the feasibility floor, which is a different thing entirely — "does
// it point at a real note" is guarded by ghost-waypoint-resolvable.spec.ts (F-A-26). The
// two names got merged into one, which is exactly how that old gap existed, so this file
// no longer shares that name.
//
// Design ([[ghost-steering]] · [[role-snapshot-frozen]]): the owner writes waypoints on a
// role (a steering destination + its supporting corpus evidence). When a session issues a
// code, this freezes into RoleSnapshot; any waypoint whose evidence_refs fall outside
// that role's granted corpus glob gets dropped whole at freeze time — a role is never
// steered toward evidence it can't see. Observation point: /internal/diag/session exposes
// role_snapshot (assembled the same way as the real downstream).
//
// RED (before implementation): createRole ignores waypoints, RoleSnapshot has no
// waypoints field -> every assertion goes red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
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

// The role is only granted wiki://projects/** — this decides the waypoint's
// **authorization** boundary.
const CORPUS_GLOBS = ['wiki://projects/**'];

// The evidence note: title 'Alpha' filed under 'projects' -> tree path projects/alpha ->
// URI wiki://projects/alpha.
//
// This originally had no seed: all three waypoints' refs pointed at notes that didn't
// exist, and the spec was green anyway — because at the time the only gate checked
// whether a ref fell inside the glob, and never asked "does the note actually exist".
// Once F-A-26 actually installed the feasibility floor, this spec immediately went red,
// and rightly so: it had been using a ghost to prove "what's in-authorization survives".
const EVIDENCE_TITLE = 'Alpha';
const EVIDENCE_PATH = 'projects/alpha';

// IN — evidence_refs all fall inside the granted glob, and resolve to a real note ->
// survives freezing.
const WP_IN = {
  waypoint_id: 'ship-alpha',
  description: 'see the Alpha project shipped last quarter',
  weight: 5,
  evidence_refs: ['wiki://projects/alpha'],
  is_terminal: false,
};
// OUT — evidence_refs all fall outside the granted glob -> dropped whole at freeze time
// (not feasible, cannot be steered toward).
const WP_OUT = {
  waypoint_id: 'secret-plan',
  description: 'steer toward a doc this role cannot see',
  weight: 9,
  evidence_refs: ['output://secret/plan'],
  is_terminal: false,
};
// TERMINAL — a terminal-type waypoint (one step from booking), refs inside the boundary
// -> survives, and is_terminal stays accurate through freezing.
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
    // Non-empty-state guard: first prove that some waypoint did freeze (the in one is
    // present), otherwise "the out one is absent" would be a false-green on an empty set.
    expect(
      wps.some((w) => w.waypoint_id === WP_IN.waypoint_id),
      'guard: in-glob waypoint 已冻结(证明冻结确实发生,out 缺席才有意义)',
    ).toBe(true);
    expect(
      wps.some((w) => w.waypoint_id === WP_OUT.waypoint_id),
      'out-of-glob waypoint 不得进冻结快照(授权下限)',
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
  // Create the evidence note before issuing the code — it must already be in the store
  // at the moment of freezing (F-A-26's feasibility floor).
  const apiToken = await createAPIToken(request, csrf, 'wpfreeze-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: EVIDENCE_TITLE, body: 'Alpha shipped last quarter.', path: EVIDENCE_PATH,
  });
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
