// use-posts —— the owner's timeline as state: what the reader's session may see (GET /api/v1/posts),
// newest first, a page at a time. The session is the one the visitor already holds (a code they
// entered, adopted from storage); with none, the server answers with the public posts. The hook never
// decides visibility — only what the server hands this session ever arrives.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adoptStoredSession, type Post } from '@standmeet/sdk-core';

import { useOptionalStandMeet } from '../provider.js';
import { widgetClient } from '../widgets/client.js';

const PAGE = 20;

export interface UsePosts {
  readonly items: readonly Post[];
  readonly loading: boolean;
  // error —— the last load failed (the caller says so in words; the reason stays in the console).
  readonly error: boolean;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
}

export function usePosts(): UsePosts {
  // Outside a provider (the app's own pages) the same-origin client every drop-in widget uses.
  const client = useOptionalStandMeet() ?? widgetClient;
  const [items, setItems] = useState<readonly Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const busy = useRef(false);

  // load —— one page after `after` (undefined = the first page); appends.
  const load = useCallback((after?: string) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const token = adoptStoredSession()?.session_token;
    client.fetchPosts({ limit: PAGE, ...(after ? { cursor: after } : {}), ...(token ? { sessionToken: token } : {}) })
      .then((page) => {
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.next_cursor || undefined);
        setError(false);
      })
      .catch((err: unknown) => { console.warn('[standmeet] posts:', err); setError(true); })
      .finally(() => { busy.current = false; setLoading(false); });
  }, [client]);

  // After mount only: the adopted session lives in the browser, and the prerender has none.
  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(() => { if (cursor) load(cursor); }, [cursor, load]);
  return { items, loading, error, hasMore: cursor !== undefined, loadMore };
}
