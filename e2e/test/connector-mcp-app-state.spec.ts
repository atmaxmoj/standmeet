// connector-mcp-app-state.spec.ts — MCP App cross-refresh state primitive + isolation
// (§1, externalized).
//
// A sandbox card (ui:// iframe) is "a small app that survives across refreshes": it
// does CRUD, through the host, on **its own mcp's slot only**. State hangs off the
// durable identity behind the session (the member), keyed by mcp:
//     state[member][mcp_id][key] = value
// mcp_id is **derived by the backend from {tool}** (capreg tool→plugin), and never
// accepted from a client-supplied mcp_id — this is the root of the isolation: a card
// can only touch the slot of the mcp its own tool belongs to.
//
// What this proves:
//   1. CRUD: set → get → delete round-trips on (member, mcp, key).
//   2. Same mcp, cross-session isolation: member A's booker-state is invisible to
//      member B's.
//   3. Same session, cross-mcp isolation: the booker slot ≠ the retrieval slot,
//      never leaking into each other.
//   4. mcp-keyed (cannot be forged): calendar_book / calendar_list_slots, both part
//      of the booker mcp, share one slot — proving the key derives from the mcp, not
//      the literal tool name, so a client naming a different tool still lands in the
//      same mcp.
//
// RED until: the backend has an mcp_app_state table + a
// /sessions/{conv}/app-state/{tool}[/{key}] endpoint (member × mcp scope, mcp derived
// from tool).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';
import { putAppState, getAppState, deleteAppState } from '@/fixtures/app-state';

test.describe('MCP App cross-refresh state primitive + isolation', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book', 'corpus.retrieval'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('CRUD: set → get → delete round-trips by (member, mcp, key)', async () => {
    const { request } = seed;
    const { session_token: tok, conversation_id: conv } = seed.visitor;
    expect(await putAppState(request, tok, conv, 'calendar_book', 'evt1', { cancelled: true })).toBe(200);
    expect(await getAppState(request, tok, conv, 'calendar_book'))
      .toMatchObject({ evt1: { cancelled: true } });
    expect(await deleteAppState(request, tok, conv, 'calendar_book', 'evt1')).toBe(200);
    expect(await getAppState(request, tok, conv, 'calendar_book')).toEqual({});
  });

  test('same mcp across sessions is isolated: member A booker-state != member B', async () => {
    const { request } = seed;
    const a = seed.visitor;
    const b = await issueSession(request, {
      handle: OWNER.handle, mode: 'code', code: seed.code.code,
      visitor_name: 'Visitor B', visitor_email: 'b@example.com',
    });
    await putAppState(request, a.session_token, a.conversation_id, 'calendar_book', 'xs', { who: 'A' });
    await putAppState(request, b.session_token, b.conversation_id, 'calendar_book', 'xs', { who: 'B' });
    expect(await getAppState(request, a.session_token, a.conversation_id, 'calendar_book'))
      .toMatchObject({ xs: { who: 'A' } });
    expect(await getAppState(request, b.session_token, b.conversation_id, 'calendar_book'))
      .toMatchObject({ xs: { who: 'B' } });
  });

  test('same session across mcps is isolated: booker slot != retrieval slot', async () => {
    const { request } = seed;
    const { session_token: tok, conversation_id: conv } = seed.visitor;
    await putAppState(request, tok, conv, 'calendar_book', 'xm', { mcp: 'booker' });
    await putAppState(request, tok, conv, 'corpus_search', 'xm', { mcp: 'retrieval' });
    const booker = await getAppState(request, tok, conv, 'calendar_book');
    const retrieval = await getAppState(request, tok, conv, 'corpus_search');
    expect((booker['xm'] as { mcp: string }).mcp).toBe('booker');
    expect((retrieval['xm'] as { mcp: string }).mcp).toBe('retrieval');
  });

  test('mcp-keyed (tools of the same mcp share one slot): what calendar_book writes, calendar_list_slots reads', async () => {
    const { request } = seed;
    const { session_token: tok, conversation_id: conv } = seed.visitor;
    await putAppState(request, tok, conv, 'calendar_book', 'shared', { v: 1 });
    // Both are part of the booker mcp → a different tool name reads the same slot
    // (proving the key derives from the mcp, not the literal tool name).
    expect(await getAppState(request, tok, conv, 'calendar_list_slots'))
      .toMatchObject({ shared: { v: 1 } });
  });
});
