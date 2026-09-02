// ghost-policy.spec.ts — Ghost steering P3: GhostPolicy's **pipeline** (deterministic, scripted
// via mock).
//
// The steering judgment itself (which waypoint to pick / whether to stay silent / momentum /
// tone) is an LLM judgment → belongs to eval (make eval-ghost, canned transcript + gold). What's
// pinned here is only the **mechanical pipeline**: policy produces a ghost → after done, a
// **singular** `ghost` frame is sent + persisted to conversation_ghosts (source='policy' +
// target_waypoint + follows_from); policy returns null → no frame is sent (silence is itself an
// action); a frame carrying ghost_id → is a genuinely persisted row (can be accepted).
//
// Mock: a non-streaming call whose system prompt contains "ONE GHOST MESSAGE" = GhostPolicy;
// scriptMockGhost sets its return value.
//
// RED (before implementation): no GhostPolicy, no singular ghost frame → the frame can't be
// found, every assertion goes red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockGhost } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'wp-policy-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wppolicy',
  fullName: 'Waypoint Policy Owner',
};
const CODE = 'WPPOLICY-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const WP = {
  waypoint_id: 'grasp-alpha',
  description: 'understand the Alpha project',
  weight: 5,
  evidence_refs: ['wiki://alpha'],
  is_terminal: false,
};

const GHOST = {
  text: 'What made you take on Alpha?',
  target_waypoint: 'grasp-alpha',
  follows_from: 'you mentioned shipping Alpha',
  is_bridge: false,
};

interface GhostFrame {
  text: string;
  target_waypoint: string;
  follows_from: string;
  ghost_id: string;
}

interface SSEEvent { type: string; data: unknown }

async function turnFrames(
  request: APIRequestContext, sess: VisitorSession, msg: string,
): Promise<SSEEvent[]> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: msg, conversation_id: sess.conversation_id },
  });
  expect(res.status(), 'agent/turn 200').toBe(200);
  const raw = await res.text();
  const events: SSEEvent[] = [];
  for (const frame of raw.split('\n\n')) {
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

function ghostFrame(events: SSEEvent[]): GhostFrame | null {
  const hits = events.filter((e) => e.type === 'ghost');
  return hits.length === 0 ? null : (hits[0]!.data as GhostFrame);
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await setup(playwright);
});

test.describe('ghost policy · 管道 · P3', () => {
  test('policy 出 ghost → done 后发单数 ghost 帧,载 text/target/follows_from', async ({ playwright }) => {
    const sess = await freshSession(playwright);
    const tag = await scriptMockGhost(sess.request, GHOST);
    const events = await turnFrames(sess.request, sess.session, `tell me about your work${tag}`);

    expect(events.filter((e) => e.type === 'ghost'), '恰一条 ghost 帧(单数,不再是 items[])')
      .toHaveLength(1);
    const g = ghostFrame(events)!;
    expect(g.text).toBe(GHOST.text);
    expect(g.target_waypoint, 'heading tag').toBe(GHOST.target_waypoint);
    expect(g.follows_from, 'coherence hook').toBe(GHOST.follows_from);
  });

  test('policy 返 null → 不发 ghost 帧(silence 是一种动作)', async ({ playwright }) => {
    const sess = await freshSession(playwright);
    const tag = await scriptMockGhost(sess.request, null);
    const events = await turnFrames(sess.request, sess.session, `just chatting${tag}`);
    expect(ghostFrame(events), 'null policy → 无 ghost 帧').toBeNull();
  });

  test('ghost 帧带 ghost_id = 已落 conversation_ghosts(source=policy)', async ({ playwright }) => {
    const sess = await freshSession(playwright);
    const tag = await scriptMockGhost(sess.request, GHOST);
    const g = ghostFrame(await turnFrames(sess.request, sess.session, `tell me more${tag}`))!;
    // The frame carrying a ghost_id means the backend has already persisted this policy ghost
    // (only a saved row gets an id); the accept side is covered by the P4 UI tests.
    expect(g.ghost_id, 'policy ghost 已落 conversation_ghosts,帧回真 id').toBeTruthy();
    expect(typeof g.ghost_id, 'id 是字符串(真行主键,非空)').toBe('string');
  });
});

interface Sess { request: APIRequestContext; session: VisitorSession }

async function freshSession(playwright: Playwright): Promise<Sess> {
  const request = await playwright.request.newContext();
  const session = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  return { request, session };
}

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // The WP's evidence note has to genuinely exist — only once feasibility clears that floor at
  // freeze time does the entry get admitted into the snapshot (F-A-26). This used to go green
  // even without seeding it: back then no gate ever asked "does this ref actually resolve to
  // anything?"
  const apiToken = await createAPIToken(request, csrf, 'wppolicy-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: 'Alpha', body: 'Alpha shipped last quarter.', path: 'alpha',
  });
  const role = await createRole(request, csrf, {
    name: 'wp-policy-role', description: 'policy spec',
    corpus_uris: ['wiki://**'], waypoints: [WP],
  });
  await createCode(request, csrf, { code: CODE, label: 'wppolicy', assumed_role_id: role.id });
  await request.dispose();
}
