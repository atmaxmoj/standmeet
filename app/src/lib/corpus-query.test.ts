// corpus-query.test.ts —— UT for the CorpusWidget query language (lives in @standmeet/sdk-core, used
// by the widget). Test-first for Spec 3: a page picks WHICH published entries show and their order.
// Pure logic → deterministic UT (the widget just applies the result to its fetched cards).

import { describe, expect, it } from 'vitest';

import { parseCorpusQuery, applyCorpusQuery } from '@standmeet/sdk-core';

const cards = [
  { title: 'Zeta', excerpt: 'z', path: 'math/algebra' },
  { title: 'Alpha', excerpt: 'a', path: 'math/logic' },
  { title: 'Bio', excerpt: 'b', path: 'science/bio' },
];

describe('parseCorpusQuery', () => {
  it('parses path (trailing glob stripped), sort, and limit', () => {
    expect(parseCorpusQuery('path:math/** sort:title limit:5'))
      .toEqual({ path: 'math/', sort: 'title', limit: 5 });
  });

  it('empty query → defaults (recent, no subtree, no cap)', () => {
    expect(parseCorpusQuery('')).toEqual({ path: '', sort: 'recent', limit: null });
  });

  it('ignores unknown tokens, a bad sort, and a non-positive limit', () => {
    expect(parseCorpusQuery('foo:bar sort:nope limit:0'))
      .toEqual({ path: '', sort: 'recent', limit: null });
  });
});

describe('applyCorpusQuery', () => {
  it('path filters to the subtree', () => {
    expect(applyCorpusQuery(cards, 'path:math/').map((c) => c.path))
      .toEqual(['math/algebra', 'math/logic']);
  });

  it('sort:title alphabetizes; recent preserves the input (server) order', () => {
    expect(applyCorpusQuery(cards, 'path:math/ sort:title').map((c) => c.title))
      .toEqual(['Alpha', 'Zeta']);
    expect(applyCorpusQuery(cards, 'path:math/').map((c) => c.title))
      .toEqual(['Zeta', 'Alpha']);
  });

  it('limit caps after filter + sort', () => {
    expect(applyCorpusQuery(cards, 'limit:2')).toHaveLength(2);
    expect(applyCorpusQuery(cards, 'path:math/** sort:title limit:1').map((c) => c.title))
      .toEqual(['Alpha']);
  });

  it('never mutates the input cards', () => {
    const before = cards.map((c) => c.title);
    applyCorpusQuery(cards, 'sort:title');
    expect(cards.map((c) => c.title)).toEqual(before);
  });
});
