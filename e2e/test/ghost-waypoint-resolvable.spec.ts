// ghost-waypoint-resolvable.spec.ts -- F-A-26: the reachability floor, at the moment of
// freezing, must look at **whether the thing being pointed to exists**, not just at
// **whether the pointing string was written**.
//
// Design ([[ghost-steering]] §Per-clause basis): the evidence gate's rationale is "a ghost
// pointing where the corpus is thin steers the conversation into a failure". An
// evidence_ref that resolves to no note at all is the thinnest kind of thin -- and it slips
// through both of the existing gates at once:
//   - FilterWaypointsByCorpus only checks whether the ref falls inside an authorized glob
//     (wiki://never-written matches wiki://** just fine);
//   - require_ghost_evidence only checks len(evidence_refs) > 0.
//
// And it's worse than "no refs written at all": WaypointLedger marks a waypoint visited by
// comparing refs against the URI derived from **the note actually cited this turn**, so a
// ref pointing at nothing can never be hit by any citation -- this waypoint is
// **permanently unreachable**, ghost keeps pushing it every turn, and "every waypoint goes
// quiet once visited" can never be satisfied for this role.
//
// RED (before the fix): the phantom entry still makes it into the frozen snapshot -> the
// second test fails.
//
// "Zero refs" is out of scope for this spec: that case is governed by the
// require_ghost_evidence knob, a switch the owner controls.

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

// The role authorizes the entire wiki -- all three waypoints' refs fall inside the
// authorized glob. The **only** thing separating them is "does the note exist"; the
// authorization layer is deliberately made indistinguishable in this spec so what it proves
// is reachability, not authorization.
const CORPUS_GLOBS = ['wiki://**'];

// Real evidence: this note gets seeded below. title 'Alpha' + path 'alpha' -> URI wiki://alpha.
const REAL_TITLE = 'Alpha';
const REAL_PATH = 'alpha';
const WP_REAL = {
  waypoint_id: 'read-alpha',
  description: 'read the Alpha note',
  weight: 5,
  evidence_refs: ['wiki://alpha'],
  is_terminal: false,
};

// Empty evidence: glob is valid, syntax is valid, points at nothing. In prod,
// read-standpoint -> subjectivity://standpoint is the real-life version of this case.
const WP_PHANTOM = {
  waypoint_id: 'read-standpoint',
  description: 'read the standpoint note',
  weight: 9,
  evidence_refs: ['wiki://standpoint-that-was-never-written'],
  is_terminal: false,
};

// Terminal + empty evidence: must **survive**. A terminal gets marked visited by a tool
// event (a completed booking), not by citation, so whether its ref resolves has no bearing
// on its reachability. This case guards against the fix overreaching -- filtering out the
// booking terminal would silence the entire conversion path.
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
    // Non-empty-state guard: first prove freezing actually happened (the real one is
    // present), otherwise "phantom is absent" could just be a false green from an empty set.
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
  // Seed the real evidence first, then issue the code -- it must already be in the corpus at
  // the moment of freezing, otherwise the "survives" assertion could fail red purely from timing.
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
