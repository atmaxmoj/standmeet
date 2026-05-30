// /writings —— Stripe-Press 风文章索引页。SSR 拉首页；infinite scroll 后续
// 页客户端补。交互 (tag filter / open article / scroll loader) 在 WritingsIndex
// 里。

import { fetchWritingsPage } from '@/lib/api/public';
import { WritingsIndex } from '@/components/writings/WritingsIndex';

export const dynamic = 'force-dynamic';

export default async function WritingsIndexPage() {
  const initial = await fetchWritingsPage();
  return (
    <WritingsIndex
      initialWritings={initial.writings}
      initialCursor={initial.next_cursor}
    />
  );
}
