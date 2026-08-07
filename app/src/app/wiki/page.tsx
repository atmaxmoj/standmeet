// /wiki —— wiki 的入口 index(reader 风)。左 240px wiki 树 sidebar(sticky,
// 自己滚)+ 主栏列出根条目。document 页的「← wiki」回到这里(每种 doc 返回
// 自己那类,不再统一回 writing)。
//
// 数据:GET /api/v1/wiki-tree(无 parent = 根),公开(无 token)只返 published。

import { getTranslations } from 'next-intl/server';

import { ReaderLayout } from '@/components/visitor/ReaderLayout';
import { WikiIndexRoots } from '@/components/visitor/WikiIndexRoots';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiTree, fetchWikiTreeStats } from '@/lib/api/public';

export const dynamic = 'force-dynamic';

export default async function WikiIndexPage() {
  const [roots, instance, stats, t] = await Promise.all([
    fetchWikiTree('', ''), fetchInstance(), fetchWikiTreeStats(),
    getTranslations('reader'),
  ]);
  return (
    <div>
      <WikiTopBar handle={instance.handle} />
      <SessionStrip />
      <ReaderLayout mainTestId="wiki-index" aside={<WikiTreeView activePath="" stats={stats} />}>
        <div className="max-w-[920px] mx-auto pt-10 pb-24">
          <div className="smallcaps mb-2">{t('wiki.indexKicker')}</div>
          <h1 className="font-serif text-(--color-ink) text-[clamp(32px,4vw,48px)] font-[380] tracking-[-0.02em] leading-[1.05] mb-8 text-pretty">
            {t('wiki.indexHeading')}
          </h1>
          {/* SSR 那份是匿名视角(SEO 要它);受邀访客的那份由客户端带 token 再取(F-L-14)。 */}
          <WikiIndexRoots roots={roots} />
        </div>
      </ReaderLayout>
    </div>
  );
}
