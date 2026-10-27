// ReaderChat —— the reader's one chat surface, the same SDK <Agent> every microsite renders.
//
// It replaces the old split (a BYOAI key-wall in the right rail for a no-session reader +
// a separate floating dock for a session). That split predated the public tier: a codeless
// reader was walled behind "bring your own key" because nobody paid for a passing visitor.
// The owner reversed that (2026-10-26): with a public tier wired, a codeless reader chats on
// the owner's model, and only brings their own key once it's spent. <Agent> already does
// exactly that (resolveAsker: stored session → coded; else public tier → public; spent/limit
// → the visitor's own key), reading the standmeet-public-chat / standmeet-page-byoai meta the
// wiki layout injects — so the reader behaves like the home page's AgentWidget, no second copy.
//
// Why one component that picks the layout, not two mounts: the chat starts with no session and
// *gets* one on the first ask (the public session is issued lazily). A design that renders the
// chat only while there's no session would unmount it the moment the visitor sends — the
// conversation would vanish mid-sentence. So the chat is mounted once and stays, across that
// transition and across articles. Rendering both an inline copy and a dock copy (hidden by CSS)
// would mount two <Agent>s against one shared session store; this picks exactly one.
//
// Wide → the right rail, symmetric with the tree on the left (the same column the key-wall used,
// same width algorithm). Narrow → the floating dock in the corner; the rail has no room there.
// The breakpoint is the rail's (1700, measured in ReaderChat.module.css), not <Agent>'s own
// 1024 — the reader's rail needs more room than a microsite's because the tree shares the margin.
//
// docContext —— the article the reader is on, so "this entry" is grounded (the old floating dock
// carried it; the SDK can't read it from meta here because a reader page isn't microsite-served).
// Derived from the URL + og:title and memoized, so moving between articles re-threads the chat.

'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { pageDocContext } from '@standmeet/sdk-core';
import { AgentWidget } from '@standmeet/sdk';

import styles from '@/components/visitor/ReaderChat.module.css';

type DocCtx = { title: string; path: string; genre: string };

// RAIL_MIN —— matches the @media threshold in ReaderChat.module.css: below it the rail can't fit
// a chat column beside the body + the tree, so the dock takes over.
const RAIL_MIN = '(min-width: 1700px)';

export function ReaderChat() {
  const wide = useWideScreen();
  const docContext = useReaderDocContext();
  return wide
    ? (
      <aside className={styles['rail']} data-testid="reader-chat-rail">
        <AgentWidget layout="inline" docContext={docContext} />
      </aside>
    )
    : <AgentWidget layout="dock" docContext={docContext} />;
}

// useReaderDocContext —— {title, path, genre:'wiki'} for the current /wiki/<path> entry (title from
// the page's og:title, path from the URL). Held in state and recomputed only when the path changes,
// so the reference stays stable across renders — <Agent> re-threads only on a real article change,
// not every render. The wiki index (no /<path>) has no doc context: a general chat, not "this entry".
function useReaderDocContext(): DocCtx | undefined {
  const pathname = usePathname();
  const [doc, setDoc] = useState<DocCtx | undefined>(undefined);
  useEffect(() => { setDoc(readerDocContext(pathname)); }, [pathname]);
  return doc;
}

function readerDocContext(pathname: string): DocCtx | undefined {
  const path = pathname.replace(/^\/wiki\//, '');
  return isEntryPath(path, pathname) ? { title: entryTitle(path), path, genre: 'wiki' } : undefined;
}

// isEntryPath —— a real /wiki/<path> entry, not the bare /wiki index (where the replace is a no-op,
// leaving path === pathname) and not an empty path.
function isEntryPath(path: string, pathname: string): boolean {
  return path !== '' && path !== pathname;
}

function entryTitle(path: string): string {
  return pageDocContext()?.title || path;
}

// useWideScreen —— read after mount (SSR has no window); the chat itself already defers its
// browser reads to after mount, so a first render in either branch is safe.
function useWideScreen(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(RAIL_MIN);
    setWide(mq.matches);
    const on = (e: MediaQueryListEvent) => { setWide(e.matches); };
    mq.addEventListener('change', on);
    return () => { mq.removeEventListener('change', on); };
  }, []);
  return wide;
}
