// /blog/[slug] —— 单篇文章。SSR 拉 post；private 文章前端按 visibility
// 渲染 LockedView (后端 visitor-chat 路径才做实际 path-glob ACL；UI 这一层
// 仅按 visibility 决定要不要锁)。
//
// 设计源自 claude.ai/design blog.js 的 ArticleView。

import { notFound } from 'next/navigation';

import { fetchPost } from '@/lib/api/public';
import { BlogArticle } from '@/components/blog/BlogArticle';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  try {
    const post = await fetchPost(slug);
    return <BlogArticle post={post} />;
  } catch {
    notFound();
  }
}
