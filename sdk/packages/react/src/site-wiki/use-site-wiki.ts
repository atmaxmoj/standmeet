// use-site-wiki.ts —— a microsite's wiki: its pages, read from and written to the microsite's own
// store (docs/design/site-wiki.md). Live, like the store: another writer's page appears at once.

'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { InsertedDoc } from '@standmeet/sdk-core';

import { useMicrositeStore } from '../use-microsite-store.js';
import { cleanPath, pagesOf, treeOf, type WikiFolder, type WikiPages } from './model.js';

export interface PageDraft {
  path: string;
  title: string;
  body: string;
  // base —— the version this draft was written over (empty for a new page): a save over a newer
  // version someone else made meanwhile is held back (SiteWiki asks first).
  base?: string;
}

export interface SiteWikiData {
  pages: WikiPages;
  tree: WikiFolder;
  // save —— a new version of the page at draft.path; the receipt, or null when refused (see error).
  save: (draft: PageDraft) => Promise<InsertedDoc | null>;
  error: string | null;
}

// SiteWikiContext —— the wiki a <SiteWikiProvider> holds for every SiteWiki part below it: one
// read, one live stream, however many parts the page uses.
export const SiteWikiContext = createContext<SiteWikiData | null>(null);

// useSiteWikiData —— the wiki read from the store (enabled false: nothing read, no stream).
export function useSiteWikiData(collection: string, enabled = true): SiteWikiData {
  const { docs, save: insert, error } = useMicrositeStore(collection, undefined, enabled);
  const pages = useMemo(() => pagesOf(docs), [docs]);
  const tree = useMemo(() => treeOf(pages), [pages]);
  const save = useCallback((d: PageDraft) => insert({
    path: cleanPath(d.path), title: d.title.trim(), body: d.body,
  }), [insert]);
  return { pages, tree, save, error };
}

// useSiteWiki —— the wiki's pages: the provider's when the component sits under a
// <SiteWikiProvider>, else read here (collection: which store collection, default 'wiki').
export function useSiteWiki(collection = 'wiki'): SiteWikiData {
  const shared = useContext(SiteWikiContext);
  const own = useSiteWikiData(collection, shared === null);
  return shared ?? own;
}

// useHashPath —— the page the address shows (#/people/the-master), and a way to go to another.
// The hash, not the path: a microsite is static files, so a reload or a shared link lands on the
// same page without the host knowing about the wiki's pages.
export function useHashPath(): [string, (path: string) => void] {
  const [path, setPath] = useState('');
  useEffect(() => {
    const read = () => { setPath(hashPath(globalThis.location?.hash ?? '')); };
    read();
    globalThis.addEventListener?.('hashchange', read);
    return () => { globalThis.removeEventListener?.('hashchange', read); };
  }, []);
  const go = useCallback((p: string) => {
    globalThis.location.hash = `/${cleanPath(p)}`;
  }, []);
  return [path, go];
}

function hashPath(hash: string): string {
  try {
    return cleanPath(decodeURIComponent(hash.replace(/^#\/?/, '')));
  } catch {
    return '';
  }
}
