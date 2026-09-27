import { describe, expect, it } from 'vitest';

import { mailInFlight, sameIds, visibleRows } from '@/lib/admin/request-rows';

const open = { id: 'a', status: 'open' };
const replied = { id: 'b', status: 'replied' };
const closed = { id: 'c', status: 'closed' };

describe('visibleRows', () => {
  it('filters by status', () => {
    expect(visibleRows([open, replied, closed], 'open', []).map((r) => r.id)).toEqual(['a']);
  });

  it('keeps a row already on screen after its status changes', () => {
    // 'b' was open when the owner looked; its mail went and it turned replied.
    expect(visibleRows([open, replied], 'open', ['a', 'b']).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('shows everything under all', () => {
    expect(visibleRows([open, replied, closed], 'all', [])).toHaveLength(3);
  });
});

describe('mailInFlight', () => {
  it('is true only while a mail is sending', () => {
    expect(mailInFlight([{ ...open, mail: { state: 'sending' } }])).toBe(true);
    expect(mailInFlight([{ ...open, mail: { state: 'sent' } }, replied])).toBe(false);
  });
});

describe('sameIds', () => {
  it('compares order and length', () => {
    expect(sameIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
  });
});
