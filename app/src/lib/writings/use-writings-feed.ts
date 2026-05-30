// use-writings-feed —— /writings index 的客户端 store。SSR 拿到
// initialWritings + initialCursor 进 hydrate；infinite-scroll observer 触发
// loadMore，store append writings + 推进 cursor。
//
// 走 zustand 因为 lint 禁 useMemo / useState 派生状态在 presentation 层。

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
