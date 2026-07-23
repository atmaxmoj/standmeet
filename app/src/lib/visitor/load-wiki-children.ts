// load-wiki-children —— LazyTree 的 wiki 数据口。每次取某层时读当前 stored
// session token(有 code → 带上走 role scope;无 → 匿名只 published),交给
// fetchWikiTree。逻辑在 lib(组件层禁 if)。

import { fetchWikiContext, fetchWikiTree } from '@/lib/api/public';
import type { TreeNode } from '@/lib/corpus/tree';
import { loadStoredSession } from '@/lib/gate/use-gate';

export function loadWikiChildren(parentID: string): Promise<TreeNode[]> {
  const token = loadStoredSession()?.session_token ?? '';
  return fetchWikiTree(parentID, token);
}

// subscribeScopedChildren —— F-L-13 reader 子条目栏的渐进增强口:有 stored session token 才按访客 scope
// 重取 context children(补上 SSR 匿名看不到的 gated 子条目),回调交出结果。无 token → no-op(SSR 的
// published children 即最终)。返回 cleanup 关掉 in-flight(unmount / slug 变时防 setState-after-unmount)。
// 逻辑归 lib:presentation 层禁 `if`,组件 effect 只 return 这一个订阅。
export function subscribeScopedChildren(
  slug: string, onChildren: (nodes: TreeNode[]) => void,
): () => void {
  const token = loadStoredSession()?.session_token ?? '';
  if (token === '') return () => {};
  let live = true;
  void fetchWikiContext(slug, token).then((ctx) => {
    if (live) onChildren(ctx.children);
  });
  return () => { live = false; };
}
