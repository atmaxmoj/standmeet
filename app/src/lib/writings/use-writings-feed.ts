// use-writings-feed —— client-side store for the /writings index. SSR's
// initialWritings + initialCursor go through hydrate; the infinite-scroll
// observer triggers loadMore, and the store appends writings and
// advances the cursor.
//
// Uses zustand because lint bans useMemo / useState derived state in
// the presentation layer.

import { create } from 'zustand';

import { fetchWritingsPage, type WritingView } from '@/lib/api/public';

interface WritingsFeedState {
  writings: WritingView[];
  cursor?: string;
  loading: boolean;
  done: boolean;
  hydrate: (writings: WritingView[], cursor?: string) => void;
  loadMore: () => Promise<void>;
}

export const useWritingsFeed = create<WritingsFeedState>((set, get) => ({
  writings: [],
  cursor: undefined,
  loading: false,
  done: false,
  hydrate: (writings, cursor) => {
    set({ writings, cursor, done: !cursor, loading: false });
  },
  loadMore: async () => {
    const s = get();
    if (s.loading || s.done || !s.cursor) return;
    set({ loading: true });
    try {
      const page = await fetchWritingsPage(s.cursor);
      set((prev) => ({
        writings: [...prev.writings, ...page.writings],
        cursor: page.next_cursor,
        done: !page.next_cursor,
        loading: false,
      }));
    } catch {
      set({ loading: false });
    }
  },
}));
