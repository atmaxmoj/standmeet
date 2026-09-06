// corpus-query.ts —— a tiny query language for CorpusWidget, so a page can pick WHICH published
// entries to show and in what order, instead of "all of them, newest first". Space-separated
// `key:value` tokens (unknown tokens ignored, so it degrades rather than errors):
//
//   path:<prefix>   only entries whose reader path starts with <prefix>. A trailing `/**` or `*` is
//                   stripped, so `path:math/**` and `path:math/` and `path:math` all mean the subtree.
//   sort:recent     newest first (the default — cards arrive created_at DESC).
//   sort:title      alphabetical by title.
//   limit:<n>       keep at most n (after filter + sort).
//
// Pure + framework-free (the widget just applies the result), so it is unit-testable directly.

import type { CorpusCard } from './types.js';

export interface CorpusQuery {
  readonly path: string; // '' = no subtree filter
  readonly sort: 'recent' | 'title';
  readonly limit: number | null; // null = no cap
}

// stripGlob —— `math/**` / `math/*` / `math/` → `math/` prefix; a bare `math` stays `math`.
function stripGlob(v: string): string {
  return v.replace(/\*+$/, '');
}

export function parseCorpusQuery(query: string): CorpusQuery {
  let path = '';
  let sort: 'recent' | 'title' = 'recent';
  let limit: number | null = null;
  for (const tok of query.trim().split(/\s+/).filter((t) => t !== '')) {
    const idx = tok.indexOf(':');
    const key = idx < 0 ? tok : tok.slice(0, idx);
    const val = idx < 0 ? '' : tok.slice(idx + 1);
    if (key === 'path') path = stripGlob(val);
    else if (key === 'sort' && (val === 'recent' || val === 'title')) sort = val;
    else if (key === 'limit') {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return { path, sort, limit };
}

// applyCorpusQuery —— filter → sort → cap. Input order is the server's (created_at DESC = recent), so
// sort:recent is a no-op that preserves it; sort:title reorders a copy. Never mutates the input.
export function applyCorpusQuery(cards: readonly CorpusCard[], query: string): CorpusCard[] {
  const q = parseCorpusQuery(query);
  const filtered = q.path === ''
    ? [...cards]
    : cards.filter((c) => c.path.startsWith(q.path));
  const sorted = q.sort === 'title'
    ? [...filtered].sort((a, b) => a.title.localeCompare(b.title))
    : filtered;
  return q.limit === null ? sorted : sorted.slice(0, q.limit);
}
