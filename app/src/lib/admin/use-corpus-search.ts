// use-corpus-search —— admin-side "find one entry by content".
//
// Why this needs to exist (F-L-39/40/41): the corpus has thousands of
// entries, and this side used to have only tag chips and a two-column grid.
// To open a note **whose name is already known**, the owner had to guess
// which tags it carried, filter down to a few dozen, then scan by eye. While
// auditing, I opened the page four times, filtered by two tags, and scrolled
// two screens without finding one note — while the visitor side had had
// search all along. The backend's full-text search was also there all
// along (`repo.*.Search`); all that was missing was wiring it up on the owner side.
//
// The shape is **the same row type** as the list (`WikiSummary`), so search
// results feed straight into the same grid — no need to write a second set
// of cards for "what got searched up".

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { WikiSummarySchema, type WikiSummary } from '@/lib/admin/use-wiki';

// How long to pause before sending the request. **Not about saving
// bandwidth**: sending on every keystroke has no guaranteed return order, and
// a stale result arriving late can overwrite a newer one — a classic source
// of "what got found doesn't match what's in the box".
const DEBOUNCE_MS = 250;

export type CorpusSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CorpusSearchHook {
  query: string;
  setQuery: (q: string) => void;
  status: CorpusSearchStatus;
  rows: readonly WikiSummary[];
  error: string | null;
  /** active —— there's text in the input: the grid should show search results, not that page's list. */
  active: boolean;
}

/**
 * searchMessageKey —— which message applies right now + the values that message needs.
 *
 * Lives at the hook layer, not the component: **"what state is this right
 * now" is a derivation, not rendering**. The component only hands the key
 * off to i18n. (The presentation layer bans writing `if` — that lint rule is exactly about this.)
 */
export function searchMessageKey(hook: CorpusSearchHook): {
  key: string; values: Record<string, string | number>;
} {
  const query = hook.query.trim();
  const byStatus: Record<CorpusSearchStatus, { key: string; values: Record<string, string | number> }> = {
    idle: { key: 'idleHint', values: {} },
    loading: { key: 'searching', values: {} },
    error: { key: 'failed', values: { reason: hook.error ?? '' } },
    // At the page cap, **"N total" must not be said** — that N is this
    // page's row count, not the total hit count. "50 entries match" on the
    // real corpus lands exactly at the cap, and the owner would read it as
    // the total ([[names-that-lie]]: a label asserting something it isn't actually tracking).
    ready: readyMessage(hook.rows.length, query),
  };
  return hook.active ? byStatus[hook.status] : byStatus.idle;
}

// PAGE_LIMIT —— the server's per-page cap (`corpus.search`'s default
// window). A row count equal to it = **there might be more**, so the wording at that point must change.
const PAGE_LIMIT = 50;

function readyMessage(count: number, query: string): {
  key: string; values: Record<string, string | number>;
} {
  const byShape: Record<'none' | 'capped' | 'all', { key: string; values: Record<string, string | number> }> = {
    none: { key: 'none', values: { query } },
    capped: { key: 'foundCapped', values: { count, query } },
    all: { key: 'found', values: { count, query } },
  };
  return byShape[searchShape(count)];
}

function searchShape(count: number): 'none' | 'capped' | 'all' {
  return count === 0 ? 'none' : (count >= PAGE_LIMIT ? 'capped' : 'all');
}

export function useCorpusSearch(genre: string): CorpusSearchHook {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CorpusSearchStatus>('idle');
  const [rows, setRows] = useState<readonly WikiSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  // seq —— only the most recently sent request counts. **Without it, a stale result would overwrite a fresh one**.
  const seq = useRef(0);

  const run = useCallback(async (q: string, mine: number) => {
    try {
      const found = await adminAPI.get(
        `/corpus/${genre}/search?q=${encodeURIComponent(q)}`,
        z.array(WikiSummarySchema),
      );
      if (seq.current !== mine) return;
      setRows(found);
      setStatus('ready');
    } catch (e) {
      if (seq.current !== mine) return;
      setError(e instanceof Error ? e.message : 'search failed');
      setStatus('error');
    }
  }, [genre]);

  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      seq.current += 1;
      setStatus('idle');
      setRows([]);
      setError(null);
      return undefined;
    }
    setStatus('loading');
    setError(null);
    const mine = seq.current + 1;
    seq.current = mine;
    const t = setTimeout(() => { void run(q, mine); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, run]);

  return { query, setQuery, status, rows, error, active: query.trim() !== '' };
}
