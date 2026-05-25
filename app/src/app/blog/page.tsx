// /blog —— Stripe-Press 风文章索引页。SSR 拉首页；infinite scroll 后续
// 页客户端补。交互 (tag filter / open article / scroll loader) 在 BlogIndex
// 里。

import { fetchPostsPage } from '@/lib/api/public';
import { BlogIndex } from '@/components/blog/BlogIndex';

export const dynamic = 'force-dynamic';

export default async function BlogIndexPage() {
  const initial = await fetchPostsPage();
  return (
    <BlogIndex
      initialPosts={initial.posts}
      initialCursor={initial.next_cursor}
    />
  );
}
