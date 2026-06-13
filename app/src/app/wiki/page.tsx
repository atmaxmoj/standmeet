// /wiki —— wiki 的入口 index(reader 风)。左 240px wiki 树 sidebar(sticky,
// 自己滚)+ 主栏列出根条目。document 页的「← wiki」回到这里(每种 doc 返回
// 自己那类,不再统一回 writing)。
//
// 数据:GET /api/v1/wiki-tree(无 parent = 根),公开(无 token)只返 seo_indexed。

import Link from 'next/link';

import { ReaderLayout } from '@/components/visitor/ReaderLayout';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiTree } from '@/lib/api/public';

export const dynamic = 'force-dynamic';

export default async function WikiIndexPage() {
  const [roots, instance] = await Promise.all([fetchWikiTree('', ''), fetchInstance()]);
  return (
    <div>
      <WikiTopBar handle={instance.handle} />
      <SessionStrip />
      <ReaderLayout mainTestId="wiki-index" aside={<WikiTreeView activePath="" />}>
        <div className="max-w-[920px] mx-auto pt-10 pb-24">
          <div className="smallcaps mb-2">wiki</div>
          <h1 className="font-serif text-(--color-ink) text-[clamp(32px,4vw,48px)] font-[380] tracking-[-0.02em] leading-[1.05] mb-8 text-pretty">
            The corpus, by entry
          </h1>
          <ul className="flex flex-col gap-3 list-none p-0 m-0" data-testid="wiki-index-roots">
            {roots.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/wiki/${n.path}`}
                  className="font-serif text-(--color-ink) hover:text-(--color-accent) text-[19px]"
                >
                  {n.title} <span className="text-(--color-faint)">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </ReaderLayout>
    </div>
  );
}
