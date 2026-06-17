// tool-endpoint-calendar-book.spec.ts —— visitor 通过 per-tool HTTP
// 端点直调 calendar_book。connector / quota / skill grant 三层 gating
// 全在 Registry.AssembleVisitor 兑现：gating 通不过 → 404
// capability_not_enabled；通过 → 200 + ok:true + capability_state
// (quota_remaining 反映剩余可 book 次数，前端 zustand 即时同步)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, seedOwnerCredentialed, teardownSeed,
  OWNER, type CodedSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession, type VisitorSession, type SessionCapability } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: { ok?: boolean; event_id?: string; conflict?: string };
  capability_state?: SessionCapability[];
}

async function callBook(
  request: APIRequestContext, sess: VisitorSession, args: object,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/calendar_book`,
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

function findCalendarCap(caps: SessionCapability[] | undefined): SessionCapability | undefined {
  return caps?.find(c => c.id === 'calendar.book');
}

test.describe('tool endpoint · calendar_book happy + gating + quota cascade', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
      max_bookings: 2,
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connector + granted skill + quota available → 200 + ok:true + capability_state',
    async () => {
      const { status, body } = await callBook(seed.request, seed.visitor, {
        topic: 'Recruiter intro',
        duration_min: 30,
        preferred_times: [future(7, 14)],
      });
      expect(status).toBe(200);
      expect(body.ok, 'endpoint envelope ok').toBe(true);
      expect(body.result?.ok, 'tool result ok').toBe(true);
      expect(body.result?.event_id, 'event_id returned').toBeTruthy();
      const cap = findCalendarCap(body.capability_state);
      expect(cap, 'calendar.book still exposed after 1 of 2 bookings').toBeDefined();
      expect(cap?.enabled).toBe(true);
      expect(cap?.quota_remaining).toBe(1);
    });

  test('second booking exhausts quota → next call returns 404 + cap absent in capability_state',
    async () => {
      // burn 2nd booking
      const second = await callBook(seed.request, seed.visitor, {
        topic: 'Second slot',
        duration_min: 30,
        preferred_times: [future(8, 15)],
      });
      expect(second.status).toBe(200);
      expect(second.body.result?.ok).toBe(true);

      // 3rd call: cap should be hidden (quota exhausted)
      const third = await callBook(seed.request, seed.visitor, {
        topic: 'Third slot',
        duration_min: 30,
        preferred_times: [future(9, 16)],
      });
      expect(third.status).toBe(404);
      expect(third.body.reason).toBe('capability_not_enabled');
      expect(findCalendarCap(third.body.capability_state),
        'cap absent in fresh state').toBeUndefined();
    });
});

test.describe('tool endpoint · calendar_book hidden when connector not OAuthed', () => {
  let seed: BaseSeed;
  let visitor: VisitorSession;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerCredentialed(playwright);   // credentials only, no OAuth
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'],
    });
    visitor = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code,
      visitor_name: 'Rachel',
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('owner not connected → calendar_book endpoint returns 404',
    async () => {
      const { status, body } = await callBook(seed.request, visitor, {
        topic: 'Will not book',
        duration_min: 30,
        preferred_times: [future(7, 14)],
      });
      expect(status).toBe(404);
      expect(body.reason).toBe('capability_not_enabled');
    });
});

test.describe('tool endpoint · calendar_book hidden when role lacks the skill', () => {
  let seed: BaseSeed;
  let visitor: VisitorSession;
  test.beforeAll(async ({ playwright }) => {
    const fullSeed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: [],   // role granted nothing
    });
    seed = fullSeed;
    visitor = fullSeed.visitor;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('role missing calendar.book grant → 404 + cap not in fresh state',
    async () => {
      const { status, body } = await callBook(seed.request, visitor, {
        topic: 'Will not book',
        duration_min: 30,
        preferred_times: [future(7, 14)],
      });
      expect(status).toBe(404);
      expect(body.reason).toBe('capability_not_enabled');
      expect(findCalendarCap(body.capability_state),
        'cap not visible when role lacks grant').toBeUndefined();
    });
});
