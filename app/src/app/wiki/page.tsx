// /wiki —— wiki 的入口 index(reader 风)。左 240px wiki 树 sidebar(sticky,
// 自己滚)+ 主栏列出根条目。document 页的「← wiki」回到这里(每种 doc 返回
// 自己那类,不再统一回 writing)。
//
// 数据:GET /api/v1/wiki-tree(无 parent = 根),公开(无 token)只返 published。

import { getTranslations } from 'next-intl/server';

import { WikiIndexRoots } from '@/components/visitor/WikiIndexRoots';
import { fetchWikiTree, fetchWikiTreeStats } from '@/lib/api/public';

export const dynamic = 'force-dynamic';

export default async function WikiIndexPage() {
  // instance / 顶栏那些由 layout 取 —— 这一页只需要自己的数据。
  const [roots, stats, t] = await Promise.all([
    fetchWikiTree('', ''), fetchWikiTreeStats(), getTranslations('reader'),
  ]);
  // 顶栏 / 会话条 / 树都在 `wiki/layout.tsx` 里 —— 它们跨文章不重挂，也不跟着正文滚。
  // 这里只出这一页自己的内容。
  return (
    <div className="pt-10 pb-24">
      <div className="smallcaps mb-2">{t('wiki.indexKicker')}</div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(32px,4vw,48px)] font-[380] tracking-[-0.02em] leading-[1.05] mb-8 text-pretty">
        {t('wiki.indexHeading')}
      </h1>
      {/* SSR 那份是匿名视角(SEO 要它);受邀访客的那份由客户端带 token 再取(F-L-14)。 */}
      <WikiIndexRoots roots={roots} stats={stats} />
    </div>
  );
}
