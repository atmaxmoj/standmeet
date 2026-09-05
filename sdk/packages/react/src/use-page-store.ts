// use-page-store.ts —— a custom page reads + writes its OWN persistence store (a poll, a sign-up
// sheet, a guestbook). The page's slug is taken from its address (/p/<slug>/…), so the page never
// has to know or pass its own id; the server scopes every read/write to that page's namespace.
//
// Reads degrade to an empty list (never throw). A write surfaces its refusal via `error` — the
// owner may have the store closed (model C), or it may be full, or the document invalid.

import { useCallback, useEffect, useState } from 'react';

import { widgetClient } from './widgets/client.js';
import type { PageDoc } from '@standmeet/sdk-core';

// currentPageSlug —— the <slug> in /p/<slug>/…. Empty off a custom page (e.g. the site root).
function currentPageSlug(): string {
  const path = globalThis.location?.pathname ?? '';
  const match = /^\/p\/([^/]+)/.exec(path);
  return match?.[1] ?? '';
}

export interface PageStore {
  docs: PageDoc[];
  save: (doc: PageDoc) => Promise<void>;
  error: string | null;
}

export function usePageStore(collection: string, slugOverride?: string): PageStore {
  const slug = slugOverride ?? currentPageSlug();
  const [docs, setDocs] = useState<PageDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDocs(await widgetClient.queryPageDocs(slug, collection));
  }, [slug, collection]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (doc: PageDoc) => {
    setError(null);
    try {
      await widgetClient.insertPageDoc(slug, collection, doc);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save');
    }
  }, [slug, collection, refresh]);

  return { docs, save, error };
}
