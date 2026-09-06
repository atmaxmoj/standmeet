// visitor-root.test.ts —— UT for the `/` render decision (chooseVisitorView). The "page under
// construction" a recruiter saw on a coded link was a RACE: the ?code= is absorbed into `pending` a
// tick AFTER the first paint, and on that first paint the old logic fell to HomeFallback. A race is
// intermittent through the browser (偶现); a unit test over the pure decision makes it deterministic
// (必现) and enumerates every state. (owner: "race condition的，可以写ut精确定位把偶现变成必现".)

import { describe, expect, it } from 'vitest';

import { chooseVisitorView } from '@/app/visitor-root';
import type { VisitorSession } from '@/lib/visitor/session-store';

function session(over: Partial<VisitorSession>): VisitorSession {
  return {
    code: null, visitor: null, byoai: false, byoaiProvider: '', label: null,
    used: 0, max: 0, startedAt: 0, maxMembers: 0, memberCount: 0,
    email: '', ownerCanDeliver: false, ...over,
  };
}

describe('chooseVisitorView — the / render decision', () => {
  it('coded visitor, first paint BEFORE the absorb runs (hasCode, no pending) → picker, never the fallback flash', () => {
    // The exact race state. Before the fix this was 'fallback' → "page under construction" flashed.
    expect(chooseVisitorView(null, false, true)).toBe('picker');
  });

  it('a pending code (absorb has run) → picker', () => {
    expect(chooseVisitorView(null, true, false)).toBe('picker');
  });

  it('both pending and hasCode → picker', () => {
    expect(chooseVisitorView(null, true, true)).toBe('picker');
  });

  it('a genuinely codeless visitor with no live home → fallback (the only state that shows it)', () => {
    expect(chooseVisitorView(null, false, false)).toBe('fallback');
  });

  it('a live code session, nothing new pending → chat (re-opening the same code stays put)', () => {
    expect(chooseVisitorView(session({ code: 'HIRING-2026' }), false, false)).toBe('chat');
    expect(chooseVisitorView(session({ code: 'HIRING-2026' }), false, true)).toBe('chat');
  });

  it('a NEW code pending while in a session → picker, to switch (not silently the old chat)', () => {
    // absorb only sets `pending` for a different code, so pending-while-in-session = a switch.
    expect(chooseVisitorView(session({ code: 'HIRING-2026' }), true, true)).toBe('picker');
    expect(chooseVisitorView(session({ code: 'HIRING-2026' }), true, false)).toBe('picker');
  });

  it('a byoai session → chat', () => {
    expect(chooseVisitorView(session({ byoai: true }), false, false)).toBe('chat');
  });
});
