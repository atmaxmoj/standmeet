// /writings —— Stripe-Press 风文章索引页。SSR 拉首页；infinite scroll 后续
// 页客户端补。交互 (tag filter / open article / scroll loader) 在 WritingsIndex
// 里。

import { fetchWritingsPage } from '@/lib/api/public';
import { WritingsIndex } from '@/components/writings/WritingsIndex';
import { WritingTreeAside } from '@/components/writings/WritingTreeAside';

export const dynamic = 'force-dynamic';

// reader 设计:240px writing 树 sidebar(复用 LazyTree)+ 主栏 blog index。
// reader = writing 的入口页(owner 拍板),纯阅读、no chat。
export default async function WritingsIndexPage() {
  const initial = await fetchWritingsPage();
  return (
    <div className="mx-auto max-w-[1180px] px-6 flex gap-12 items-start">
      <div className="hidden lg:block pt-10">
        <WritingTreeAside activeSlug="" />
      </div>
      <div className="min-w-0 flex-1">
        <WritingsIndex
          initialWritings={initial.writings}
          initialCursor={initial.next_cursor}
        />
      </div>
    </div>
  );
}
