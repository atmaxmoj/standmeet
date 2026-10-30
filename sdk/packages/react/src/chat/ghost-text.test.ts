// ghost-text.test.ts —— what Tab fills in the composer (owner, 2026-10-30).
//
// Spec: Tab auto-fills ONLY when the box is empty and there's a suggestion to take — the dynamic
// ghost if one exists, otherwise the first visible cold-start starter. When the visitor has typed,
// or nothing is suggested, Tab returns null so it falls through to its browser default (move focus
// to the next control). On a fresh writing page there's no dynamic ghost, only starters, so Tab
// did nothing before this.

import { describe, expect, it } from 'vitest';

import { tabAccept } from './ghost-text.js';

const base = {
  value: '',
  blocked: false,
  ghost: null as string | null,
  showStarters: true,
  starters: ['First?', 'Second?'] as readonly string[],
};

describe('tabAccept — what Tab fills', () => {
  it('empty + a dynamic ghost → the ghost', () => {
    expect(tabAccept({ ...base, ghost: 'the next question?' })).toBe('the next question?');
  });

  it('empty + no ghost + starters → the first starter (fresh writing page)', () => {
    expect(tabAccept({ ...base, ghost: null })).toBe('First?');
  });

  it('has text → null, Tab falls through to default', () => {
    expect(tabAccept({ ...base, value: 'typed', ghost: 'g' })).toBeNull();
    expect(tabAccept({ ...base, value: 'typed', ghost: null })).toBeNull();
  });

  it('no ghost and no starters → null', () => {
    expect(tabAccept({ ...base, ghost: null, starters: [] })).toBeNull();
  });

  it('no ghost and starters hidden → null', () => {
    expect(tabAccept({ ...base, ghost: null, showStarters: false })).toBeNull();
  });

  it('blocked (pending / exhausted) → null, never fills', () => {
    expect(tabAccept({ ...base, blocked: true, ghost: 'g' })).toBeNull();
    expect(tabAccept({ ...base, blocked: true, ghost: null })).toBeNull();
  });
});
