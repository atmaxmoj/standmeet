// /writings/[slug] —— 单篇文章。SSR 拉 writing；private 文章前端按
// visibility 渲染 LockedView (后端 visitor-chat 路径才做实际 path-glob ACL；
// UI 这一层仅按 visibility 决定要不要锁)。
//
// 设计源自 claude.ai/design blog.js 的 ArticleView。

import { notFound } from 'next/navigation';

import { fetchWriting } from '@/lib/api/public';
import { WritingArticle } from '@/components/writings/WritingArticle';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function WritingArticlePage({ params }: PageProps) {
  const { slug } = await params;
  try {
    const writing = await fetchWriting(slug);
    return <WritingArticle writing={writing} />;
  } catch {
    notFound();
  }
}
