// ghost-telemetry.spec.ts —— Ghost steering telemetry: per-waypoint funnel (policy ghosts shown vs
// accepted) at GET /api/admin/ghosts/telemetry.
//
// Seed via the real policy pipeline (scriptMockGhost → agent/turn emits a `ghost` frame carrying a
// ghost_id = a persisted conversation_ghosts row). Accepting one calls the public accept endpoint
// (sets accepted_at). Then the owner queries telemetry and gets the per-waypoint shown/accepted/rate
// aggregate. (silence rate needs turn-total data — a separate source — so it's out of this endpoint.)
//
// RED (before impl): /api/admin/ghosts/telemetry doesn't exist → 404 → assertions red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockGhost } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'ghost-telemetry-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghosttelem',
  fullName: 'Ghost Telemetry Owner',
};
const CODE = 'GHOSTTELEM-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const WP_A = {
  waypoint_id: 'grasp-alpha', description: 'understand Alpha',
  weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
};
const WP_B = {
  waypoint_id: 'grasp-beta', description: 'understand Beta',
  weight: 3, evidence_refs: ['wiki://beta'], is_terminal: false,
};

function ghostFor(waypoint: string) {
  return {
    text: `Tell me about ${waypoint}?`, target_waypoint: waypoint,
    follows_from: 'you mentioned it', is_bridge: false,
  };
}

interface SSEEvent { type: string; data: unknown }
interface GhostFrame { ghost_id: string; target_waypoint: string }

async function turnFrames(
  request: APIRequestContext, sess: VisitorSession, msg: string,
): Promise<SSEEvent[]> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: msg, conversation_id: sess.conversation_id },
  });
  expect(res.status(), 'agent/turn 200').toBe(200);
  const events: SSEEvent[] = [];
  for (const frame of (await res.text()).split('\n\n')) {
    let evType = '';
    let evData = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) evType = line.slice(7).trim();
      else if (line.startsWith('data: ')) evData = line.slice(6).trim();
    }
    if (evType !== '') events.push({ type: evType, data: JSON.parse(evData) as unknown });
  }
  return events;
}

// emitGhost —— script a policy ghost for `waypoint`, run a turn, return the persisted ghost_id.
async function emitGhost(
  request: APIRequestContext, sess: VisitorSession, waypoint: string,
): Promise<string> {
  const tag = await scriptMockGhost(request, ghostFor(waypoint));
  const events = await turnFrames(request, sess, `talk about ${waypoint}${tag}`);
  const g = events.find((e) => e.type === 'ghost')?.data as GhostFrame | undefined;
  expect(g?.ghost_id, `ghost persisted for ${waypoint}`).toBeTruthy();
  return g!.ghost_id;
}

async function acceptGhost(
  request: APIRequestContext, sess: VisitorSession, ghostID: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/ghosts/${ghostID}/accept`,
    { headers: { Authorization: `Bearer ${sess.session_token}` } },
  );
  expect(res.status(), 'accept 2xx').toBeLessThan(300);
}

interface WaypointStat {
  target_waypoint: string; shown: number; accepted: number; acceptance_rate: number;
}
interface Telemetry {
  waypoints: WaypointStat[];
  totals: { shown: number; accepted: number; acceptance_rate: number };
}

async function fetchTelemetry(request: APIRequestContext, csrf: string): Promise<Telemetry> {
  const res = await request.get(`${BACKEND}/api/admin/ghosts/telemetry`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status(), 'telemetry 200').toBe(200);
  return await res.json() as Telemetry;
}

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'telem-role', description: 'ghost telemetry',
    corpus_uris: ['wiki://**', 'output://**'], waypoints: [WP_A, WP_B],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'telem', assumed_role_id: role.id, ghosts: [],
  });
  await request.dispose();
}

test.beforeAll(async ({ playwright }) => { await setup(playwright); });

test.describe('ghost telemetry · per-waypoint funnel', () => {
  test('shown/accepted aggregate per waypoint + totals', async ({ playwright }) => {
    const visitor = await playwright.request.newContext();
    const sess = await issueSession(visitor, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });

    // grasp-alpha: 2 shown, 1 accepted (rate 0.5). grasp-beta: 1 shown, 1 accepted (rate 1.0).
    const a1 = await emitGhost(visitor, sess, 'grasp-alpha');
    await acceptGhost(visitor, sess, a1);
    await emitGhost(visitor, sess, 'grasp-alpha'); // shown, not accepted
    const b1 = await emitGhost(visitor, sess, 'grasp-beta');
    await acceptGhost(visitor, sess, b1);
    await visitor.dispose();

    const owner = await playwright.request.newContext();
    const { csrf } = await loginAPI(owner, OWNER.email, OWNER.password);
    const telem = await fetchTelemetry(owner, csrf);

    const alpha = telem.waypoints.find((wp) => wp.target_waypoint === 'grasp-alpha');
    expect(alpha, 'alpha present').toBeDefined();
    expect(alpha?.shown, 'alpha shown').toBe(2);
    expect(alpha?.accepted, 'alpha accepted').toBe(1);
    expect(alpha?.acceptance_rate, 'alpha rate').toBeCloseTo(0.5, 3);

    const beta = telem.waypoints.find((wp) => wp.target_waypoint === 'grasp-beta');
    expect(beta?.shown, 'beta shown').toBe(1);
    expect(beta?.accepted, 'beta accepted').toBe(1);
    expect(beta?.acceptance_rate, 'beta rate').toBeCloseTo(1.0, 3);

    expect(telem.totals.shown, 'total shown').toBe(3);
    expect(telem.totals.accepted, 'total accepted').toBe(2);
    await owner.dispose();
  });
});
