// ghost-telemetry-admin.spec.ts —— the admin UI panel for the per-waypoint ghost funnel.
//
// Backend GET /api/admin/ghosts/telemetry is covered by ghost-telemetry.spec.ts; this drives the
// admin conversations section and asserts the funnel PANEL renders the seeded waypoint row
// (shown / accepted / acceptance-rate). Seed via the real policy pipeline (scriptMockGhost → a
// `ghost` frame carrying a persisted ghost_id) + the public accept endpoint.
//
// RED (before impl): the ConversationsSection has no ghost-telemetry panel → getByTestId misses.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockGhost } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'ghost-telem-ui@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghosttelemui',
  fullName: 'Ghost Telemetry UI Owner',
};
const CODE = 'GHOSTTELEMUI-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const WP_A = {
  waypoint_id: 'grasp-alpha', description: 'understand Alpha',
  weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
};

interface SSEEvent { type: string; data: unknown }
interface GhostFrame { ghost_id: string }

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

async function emitGhost(request: APIRequestContext, sess: VisitorSession): Promise<string> {
  const tag = await scriptMockGhost(request, {
    text: 'Tell me about grasp-alpha?', target_waypoint: 'grasp-alpha',
    follows_from: 'you mentioned it', is_bridge: false,
  });
  const events = await turnFrames(request, sess, `talk about alpha${tag}`);
  const g = events.find((e) => e.type === 'ghost')?.data as GhostFrame | undefined;
  expect(g?.ghost_id, 'ghost persisted').toBeTruthy();
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

// seed grasp-alpha: 2 shown, 1 accepted → rate 0.5.
async function seed(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'telem-ui-role', description: 'ghost telemetry ui',
    corpus_uris: ['wiki://**', 'output://**'], waypoints: [WP_A],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'telemui', assumed_role_id: role.id, ghosts: [],
  });
  await request.dispose();

  const visitor = await playwright.request.newContext();
  const sess = await issueSession(visitor, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
  const g1 = await emitGhost(visitor, sess);
  await acceptGhost(visitor, sess, g1);
  await emitGhost(visitor, sess); // shown, not accepted
  await visitor.dispose();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('ghost telemetry · admin funnel panel', () => {
  test.beforeAll(async ({ playwright }) => { await seed(playwright); });

  test('conversations section shows the per-waypoint funnel', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'conversations');
    const panel = adminPage.getByTestId('ghost-telemetry-panel');
    await expect(panel, 'ghost telemetry panel renders').toBeVisible();

    const row = adminPage.getByTestId('ghost-telemetry-row').filter({ hasText: 'grasp-alpha' });
    await expect(row, 'grasp-alpha row present').toBeVisible();
    await expect(row, 'shows shown=2').toContainText('2');
    await expect(row, 'shows accepted=1').toContainText('1');
    await expect(row, 'shows 50% acceptance rate').toContainText('50%');
  });
});
