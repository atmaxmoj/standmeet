// WritingCrumb —— /writings/[slug] 面包屑里的一格。
//
// 单独抽出来只为一件事:它得是**客户端**组件,才能读得到读者当前选的语言
// (`useCorpusHref`)。面包屑是往回走的那条路,跟树上往下走是同一段阅读 ——
// 往下走带着语言、往回走却掉回英文,那这个选择照样是半个。
// 页面本身是服务端组件,`use client` 只能整文件标,所以这一格搬出来。

'use client';

import Link from 'next/link';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import type { TreeNode } from '@/lib/corpus/tree';

export function WritingCrumb({ node }: { node: TreeNode }) {
  const href = useCorpusHref();
  return (
    <>
      <span className="text-(--color-faint)">{'▸'}</span>
      <Link
        href={href({ genre: 'writing', slug: node.path })}
        className="text-(--color-muted) hover:text-(--color-ink)"
      >
        {node.title}
      </Link>
    </>
  );
}
