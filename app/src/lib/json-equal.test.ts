import { describe, it, expect } from 'vitest';

import { jsonEqual } from '@/lib/json-equal';

describe('jsonEqual', () => {
  it('deep-compares nested objects + arrays by value, order-independent on keys', () => {
    expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(jsonEqual([{ x: 1 }, { y: 2 }], [{ x: 1 }, { y: 2 }])).toBe(true);
  });

  it('is not fooled by a change that is undone back to the same value (not an edit trace)', () => {
    const saved = { root: { props: { coverLetter: 'hi' } }, content: [{ type: 'H', props: { n: 1 } }] };
    const edited = { root: { props: { coverLetter: 'hi CHANGED' } }, content: [{ type: 'H', props: { n: 1 } }] };
    const undone = { root: { props: { coverLetter: 'hi' } }, content: [{ type: 'H', props: { n: 1 } }] };
    expect(jsonEqual(saved, edited)).toBe(false); // an edit → different
    expect(jsonEqual(saved, undone)).toBe(true); // edited back to the saved value → equal again
  });

  it('flags any nested difference, including array order and length', () => {
    expect(jsonEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(jsonEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
