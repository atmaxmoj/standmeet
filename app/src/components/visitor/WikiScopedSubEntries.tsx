// WikiScopedSubEntries —— F-L-13 reader 条目页的「子条目」栏。SSR 用匿名 scope 取 context,所以一个
// 受邀访客(带 code 的 role scope)看不到自己的 gated 子条目 —— 栏是空的,页面成了导航死胡同。这里做
// 渐进增强:先渲 SSR 给的(published)children,mount 后拿 stored session token 再按访客 scope 重取一次,
// 把 gated 子条目补上。无 token(匿名)→ 不重取,SSR 的 published 列表即最终。逻辑照抄 load-wiki-children
// 的 token 取法(reader 侧栏懒加载也这么做)。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { TreeNode } from '@/lib/corpus/tree';
import { subscribeScopedChildren } from '@/lib/visitor/load-wiki-children';

export function WikiScopedSubEntries({ slug, initial }: { slug: string; initial: TreeNode[] }) {
  const t = useTranslations('reader');
  const [nodes, setNodes] = useState<TreeNode[]>(initial);
  useEffect(() => subscribeScopedChildren(slug, setNodes), [slug]);
  return nodes.length > 0 ? (
    <div className="mt-12" data-testid="wiki-subentries">
      <div className="smallcaps mb-3">{t('wiki.subEntries')}</div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 list-none p-0 m-0">
        {nodes.map((c) => (
          <li key={c.id}>
            <Link
              href={`/wiki/${c.path}`}
              className="reading text-(--color-ink) hover:text-(--color-accent) text-[15px]"
            >
              {c.title} <span className="text-(--color-faint)">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
