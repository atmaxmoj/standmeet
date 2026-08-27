// WikiIndexRoots —— /wiki 索引正文里的根条目列表。
//
// 为什么它必须是客户端组件:访客的 session token 只存在浏览器里,SSR 看不见。页面在服务端
// 用匿名身份取根条目,拿回来的只有 published 的那些 —— 于是一个 role 授了 `wiki://**` 的受邀
// 访客,在侧栏树里列得出全部四个根、每个条目页都打得开、聊天还引用了 11 条笔记,而**索引**
// 只给他一条,脚注写着「222 GATED」。四个面对同一个问题给了两种答案(F-L-14)。
//
// 修法跟 F-L-11(reader 正文)和 F-L-13(子条目栏)是同一条:SSR 给匿名那一份保底(SEO 要它),
// 挂载后带 token 再取一次,有更多就换上。
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeNode } from '@/lib/corpus/tree';
import { WikiIndexEmpty } from '@/components/visitor/WikiIndexEmpty';
import { subscribeScopedRoots } from '@/lib/visitor/load-wiki-children';

export function WikiIndexRoots({ roots, stats }: {
  roots: readonly TreeNode[];
  stats: WikiTreeStats;
}) {
  const [scoped, setScoped] = useState<readonly TreeNode[] | null>(null);
  useEffect(() => subscribeScopedRoots(setScoped), []);
  const shown = scoped ?? roots;
  return (
    <>
      <ul className="flex flex-col gap-3 list-none p-0 m-0" data-testid="wiki-index-roots">
        {shown.map((n) => (
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
      {/* 空列表自己说明为什么 —— 那句话以前只在侧栏里，而侧栏在窄屏上不存在。 */}
      <WikiIndexEmpty stats={stats} empty={shown.length === 0} />
    </>
  );
}
