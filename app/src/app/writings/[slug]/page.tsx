// /writings/[slug] — single article, reader frame: 240px writing tree sidebar (current
// article highlighted) + main column breadcrumb ancestor chain + article. Frontend renders
// private articles as LockedView based on visibility (only the backend visitor-chat path
// does the real path-glob ACL; this UI layer only decides the lock by visibility).
//
// Design source: reader.html (tree sidebar + pure reading) + blog.js ArticleView.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { WritingCrumb } from '@/components/writings/WritingCrumb';
import { fetchWriting, fetchWritingContext } from '@/lib/api/public';
import { WritingArticle } from '@/components/writings/WritingArticle';
import { ReaderLayout } from '@/components/visitor/ReaderLayout';
import { WritingTreeAside } from '@/components/writings/WritingTreeAside';
import type { TreeNode } from '@/lib/corpus/tree';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  // searchParams — `?lang=zh`. Same convention as the wiki reader: for a multilingual
  // article the **server** picks the language up front, so crawlers and agents fetch the
  // actual content instead of both versions being sent with one hidden (F-R-6).
  searchParams: Promise<{ lang?: string }>;
}

export default async function WritingArticlePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  // Uses the same reader skeleton as wiki (ReaderLayout). This used to have its own
  // hand-rolled flex (tree + `flex-1` body), so the same bug showed up twice: the body
  // only centered within **the leftover space outside the tree** (readers saw a
  // misaligned article), and the tree's cut edge had no continuation cue. Sharing one
  // skeleton means "body centers on viewport" and "cut edge fades" only need to hold in
  // one place.
  const { lang } = await searchParams;
  try {
    const writing = await fetchWriting(slug, lang ?? '');
    const ctx = await fetchWritingContext(slug);
    return (
      <ReaderLayout mainTestId="writing-page" aside={<WritingTreeAside activeSlug={slug} />}>
        <ReaderBreadcrumb ancestors={ctx.ancestors} current={writing.title} />
        <WritingArticle writing={writing} />
      </ReaderLayout>
    );
  } catch {
    notFound();
  }
}

// ReaderBreadcrumb — ← writing / writing ▸ ancestor chain ▸ current article. Ancestors
// come from context (the published tree); each is clickable back to its own article; the
// current article is plain text.
async function ReaderBreadcrumb({ ancestors, current }: { ancestors: TreeNode[]; current: string }) {
  const t = await getTranslations('writings.breadcrumb');
  return (
    <nav
      className="smallcaps flex items-baseline gap-2 flex-wrap pt-10"
      data-testid="writing-breadcrumb"
    >
      <Link href="/writings" className="text-(--color-muted) hover:text-(--color-ink)">{t('back')}</Link>
      {ancestors.map((a) => <WritingCrumb key={a.id} node={a} />)}
      <span className="text-(--color-faint)">{'▸'}</span>
      <span className="text-(--color-ink)">{current}</span>
    </nav>
  );
}

