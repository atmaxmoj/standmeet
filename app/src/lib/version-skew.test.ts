// version-skew.test.ts —— Q5: the MCP client's skew classifier (in @standmeet/sdk-core, tested here
// from the app's vitest — the same pattern as corpus-query). Pins the verdict boundaries so a would-be
// silent auth break surfaces as a clear advisory instead.

import { describe, it, expect } from 'vitest';

import { classifySkew } from '@standmeet/sdk-core';

describe('classifySkew', () => {
  it('equal versions → ok, no message', () => {
    const r = classifySkew('0.1.24', '0.1.24');
    expect(r.verdict).toBe('ok');
    expect(r.message).toBe('');
  });

  it('client older than the instance (no floor) → warn, names update_self', () => {
    const r = classifySkew('0.1.23', '0.1.24');
    expect(r.verdict).toBe('warn');
    expect(r.message).toContain('update_self');
  });

  it('client newer than the instance → warn (still a mismatch)', () => {
    expect(classifySkew('0.2.0', '0.1.24').verdict).toBe('warn');
  });

  it('client below the min-compatible floor → incompatible', () => {
    const r = classifySkew('0.1.0', '0.2.0', '0.2.0');
    expect(r.verdict).toBe('incompatible');
    expect(r.message).toContain('update_self');
  });

  it('client at/above the floor but different → warn, not incompatible', () => {
    expect(classifySkew('0.2.1', '0.2.5', '0.2.0').verdict).toBe('warn');
  });

  it('v-prefix and whitespace are tolerated', () => {
    expect(classifySkew('v0.1.24', ' 0.1.24 ').verdict).toBe('ok');
  });

  it('unknown/unparseable versions → ok (never nag on missing data)', () => {
    expect(classifySkew('unknown', '0.1.24').verdict).toBe('ok');
    expect(classifySkew('0.1.24', '').verdict).toBe('ok');
  });
});
