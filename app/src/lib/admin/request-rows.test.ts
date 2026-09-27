import { describe, expect, it } from 'vitest';

import { filterOf, mailInFlight, statusParam } from '@/lib/admin/request-rows';

describe('statusParam / filterOf', () => {
  it('all is no status filter on the server', () => {
    expect(statusParam('all')).toBe('');
    expect(filterOf('')).toBe('all');
  });

  it('round-trips the three statuses', () => {
    for (const f of ['open', 'replied', 'closed'] as const) expect(filterOf(statusParam(f))).toBe(f);
  });
});

describe('mailInFlight', () => {
  it('is the rows whose mail is still sending', () => {
    const rows = [
      { id: 'a', mail: { state: 'sending' } }, { id: 'b', mail: { state: 'sent' } }, { id: 'c' },
    ];
    expect(mailInFlight(rows).map((r) => r.id)).toEqual(['a']);
  });
});
