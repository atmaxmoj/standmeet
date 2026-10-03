// use-microsite-store.ts —— a microsite reads + writes its OWN persistence store (a poll, a sign-up
// sheet, a guestbook, a manuscript several people write). The page's slug is taken from its address
// (/p/<slug>/…), so the page never has to know or pass its own id; the server scopes every
// read/write to that page's namespace.
//
// Live: the list follows the store — another visitor's write, the agent's, the owner's approval
// or delete appear on every open page without a reload (the store stream).
//
// Reads degrade to an empty list (never throw). A write surfaces its refusal via `error` — the
// owner may have the store closed (model C), or it may be full, or the document invalid.

import { useCallback, useEffect, useState } from 'react';

import { widgetClient } from './widgets/client.js';
import type { InsertedDoc, MicrositeDoc, StoredDoc } from '@standmeet/sdk-core';

// currentPageSlug —— the <slug> in /p/<slug>/…. Empty off a microsite (e.g. the site root).
function currentPageSlug(): string {
  const path = globalThis.location?.pathname ?? '';
  const match = /^\/p\/([^/]+)/.exec(path);
  return match?.[1] ?? '';
}

export interface MicrositeStore {
  // docs —— the published documents, oldest first, each with the host's `_id` and `_author`.
  docs: StoredDoc[];
  // save —— the receipt (pending: it waits for the owner's review), or null when refused (see error).
  save: (doc: MicrositeDoc) => Promise<InsertedDoc | null>;
  error: string | null;
}

// enabled —— false: read nothing and open no stream (a component that gets the same data from a
// provider above it still calls this hook, unconditionally, as hooks must be).
export function useMicrositeStore(
  collection: string, slugOverride?: string, enabled = true,
): MicrositeStore {
  const slug = slugOverride ?? currentPageSlug();
  const [docs, setDocs] = useState<StoredDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setDocs(await widgetClient.queryMicrositeDocs(slug, collection));
  }, [slug, collection]);

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    if (slug === '') return undefined;
    return widgetClient.watchMicrositeStore(slug, () => { void refresh(); });
  }, [slug, refresh, enabled]);

  const save = useCallback(async (doc: MicrositeDoc): Promise<InsertedDoc | null> => {
    setError(null);
    try {
      const got = await widgetClient.insertMicrositeDoc(slug, collection, doc);
      await refresh();
      return got;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save');
      return null;
    }
  }, [slug, collection, refresh]);

  return { docs, save, error };
}
