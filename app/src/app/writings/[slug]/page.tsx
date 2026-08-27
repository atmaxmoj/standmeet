// /writings/[slug] —— 单篇文章,reader 框:240px writing 树 sidebar(当前篇高亮)
// + 主栏 breadcrumb 祖先链 + 文章。private 文章前端按 visibility 渲 LockedView
// (后端 visitor-chat 路径才做实际 path-glob ACL;UI 这层仅按 visibility 决定锁)。
//
// 设计源 reader.html(tree sidebar + 纯阅读)+ blog.js ArticleView。

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { corpusHref } from '@/lib/corpus/href';
import { fetchWriting, fetchWritingContext } from '@/lib/api/public';
import { WritingArticle } from '@/components/writings/WritingArticle';
import { WritingTreeAside } from '@/components/writings/WritingTreeAside';
import type { TreeNode } from '@/lib/corpus/tree';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  // searchParams —— `?lang=zh`。跟 wiki reader 同一个约定：多语文章**服务端**就挑好那一面，
  // 于是爬虫和 agent 抓到的是内容，而不是两份都发下来再藏一份（F-R-6）。
  searchParams: Promise<{ lang?: string }>;
}

export default async function WritingArticlePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { lang } = await searchParams;
  try {
    const writing = await fetchWriting(slug, lang ?? '');
    const ctx = await fetchWritingContext(slug);
    return (
      <div className="mx-auto max-w-[1180px] px-6 flex gap-12 items-start">
        <div className="hidden lg:block pt-10">
          <WritingTreeAside activeSlug={slug} />
        </div>
        <div className="min-w-0 flex-1">
          <ReaderBreadcrumb ancestors={ctx.ancestors} current={writing.title} />
          <WritingArticle writing={writing} />
        </div>
      </div>
    );
  } catch {
    notFound();
  }
}

// ReaderBreadcrumb —— ← writing / writing ▸ 祖先链 ▸ 当前篇。祖先来自 context
// (published 树),每个可点回各自文章;当前篇纯文字。
async function ReaderBreadcrumb({ ancestors, current }: { ancestors: TreeNode[]; current: string }) {
  const t = await getTranslations('writings.breadcrumb');
  return (
    <nav
      className="smallcaps flex items-baseline gap-2 flex-wrap pt-10"
      data-testid="writing-breadcrumb"
    >
      <Link href="/writings" className="text-(--color-muted) hover:text-(--color-ink)">{t('back')}</Link>
      {ancestors.map((a) => <Crumb key={a.id} node={a} />)}
      <span className="text-(--color-faint)">{'▸'}</span>
      <span className="text-(--color-ink)">{current}</span>
    </nav>
  );
}

function Crumb({ node }: { node: TreeNode }) {
  return (
    <>
      <span className="text-(--color-faint)">{'▸'}</span>
      <Link href={corpusHref({ genre: 'writing', slug: node.path })} className="text-(--color-muted) hover:text-(--color-ink)">
        {node.title}
      </Link>
    </>
  );
}
