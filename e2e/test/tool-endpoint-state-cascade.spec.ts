// tool-endpoint-state-cascade.spec.ts — a cross-cutting invariant: the
// capability_state carried in a per-tool endpoint's response is always the **current**
// Registry-evaluated state, regardless of "which tool was called".
//
// Key scenario: after calling calendar_book once (burning its quota), the next call to
// any tool at all (e.g. corpus_search) should already show calendar.book gated out in
// capability_state (max_bookings is full → ErrHidden). The frontend's zustand syncs from
// any tool response, and once pi-agent-core reassembles the system prompt, calendar_book
// is no longer visible — fulfilling the invariant "a denial returns fresh state → the
// frontend zustand force-syncs → pi reassembles the tool set".

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: unknown;
  capability_state?: SessionCapability[];
}

async function callTool(
  request: APIRequestContext, sess: VisitorSession,
  toolName: string, args: object,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${toolName}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: args,
    },
  );
  const status = res.status();
  const body = await res.json() as ToolResp;
  return { status, body };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function findCap(caps: SessionCapability[] | undefined, id: string): SessionCapability | undefined {
  return caps?.find(c => c.id === id);
}

test.describe('tool endpoint · capability_state cascade is cross-tool', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
      max_bookings: 1,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('before burn: corpus_search response shows calendar.book enabled + quota_remaining=1',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'corpus_search', { query: 'anything' },
      );
      expect(status).toBe(200);
      const cal = findCap(body.capability_state, 'calendar.book');
      expect(cal, 'calendar.book visible before burn').toBeDefined();
      expect(cal?.enabled).toBe(true);
      expect(cal?.quota_remaining).toBe(1);
    });

  test('burn calendar_book (max_bookings=1) → cap immediately gated out in same response',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'calendar_book', {
          topic: 'Only allowed slot',
          duration_min: 30,
          preferred_times: [future(7, 14)],
        },
      );
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      // After the handler runs the executor, it **reassembles** to get fresh cap
      // state; the booking is already persisted (count=1==max), so gating hides
      // calendar.book immediately. The cap should be absent from the response — this
      // is the core of the cascade: a state change triggered by the tool's own
      // execution is already visible to the frontend in that same response.
      expect(
        findCap(body.capability_state, 'calendar.book'),
        'calendar.book gated out immediately after the burn call',
      ).toBeUndefined();
    });

  test('after burn: corpus_search response shows calendar.book gated out (cross-tool invariant)',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'corpus_search', { query: 'anything' },
      );
      expect(status).toBe(200);
      expect(
        findCap(body.capability_state, 'calendar.book'),
        'calendar.book absent from any tool response after quota exhausted',
      ).toBeUndefined();
      // corpus.retrieval is unaffected
      expect(
        findCap(body.capability_state, 'corpus.retrieval')?.enabled,
      ).toBe(true);
    });

  test('after burn: re-calling calendar_book → 404 + capability_state still excludes it',
    async () => {
      const { status, body } = await callTool(
        seed.request, seed.visitor, 'calendar_book', {
          topic: 'Tries again',
          duration_min: 30,
          preferred_times: [future(8, 14)],
        },
      );
      expect(status).toBe(404);
      expect(body.reason).toBe('capability_not_enabled');
      expect(
        findCap(body.capability_state, 'calendar.book'),
        'still absent from cap state after a denied call',
      ).toBeUndefined();
    });
});
