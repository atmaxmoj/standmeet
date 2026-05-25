// use-blog-feed —— /blog index 的客户端 store。SSR 拿到 initialPosts +
// initialCursor 进 hydrate；infinite-scroll observer 触发 loadMore，store
// append posts + 推进 cursor。
//
// 走 zustand 因为 lint 禁 useMemo / useState 派生状态在 presentation 层。

import { create } from 'zustand';

import { fetchPostsPage, type PostView } from '@/lib/api/public';

interface BlogFeedState {
  posts: PostView[];
  cursor?: string;
  loading: boolean;
  done: boolean;
  hydrate: (posts: PostView[], cursor?: string) => void;
  loadMore: () => Promise<void>;
}

export const useBlogFeed = create<BlogFeedState>((set, get) => ({
  posts: [],
  cursor: undefined,
  loading: false,
  done: false,
  hydrate: (posts, cursor) => {
    set({ posts, cursor, done: !cursor, loading: false });
  },
  loadMore: async () => {
    const s = get();
    if (s.loading || s.done || !s.cursor) return;
    set({ loading: true });
    try {
      const page = await fetchPostsPage(s.cursor);
      set((prev) => ({
        posts: [...prev.posts, ...page.posts],
        cursor: page.next_cursor,
        done: !page.next_cursor,
        loading: false,
      }));
    } catch {
      set({ loading: false });
    }
  },
}));
