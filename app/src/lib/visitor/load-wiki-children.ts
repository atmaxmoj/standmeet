// load-wiki-children —— LazyTree 的 wiki 数据口。每次取某层时读当前 stored
// session token(有 code → 带上走 role scope;无 → 匿名只 published),交给
// fetchWikiTree。逻辑在 lib(组件层禁 if)。

import { fetchWikiContext, fetchWikiTree, fetchWikiTreeStats } from '@/lib/api/public';
import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeNode } from '@/lib/corpus/tree';
import { loadStoredSession } from '@/lib/gate/use-gate';

export function loadWikiChildren(parentID: string): Promise<TreeNode[]> {
  const token = loadStoredSession()?.session_token ?? '';
  return fetchWikiTree(parentID, token);
}

// storedToken —— 访客的 session token 只存在浏览器里,SSR 看不见。这就是为什么每一处
// "受邀访客该看见更多"的地方都要在客户端补一次(F-L-11 的 reader、F-L-13 的子条目栏,
// 现在还有 F-L-14 的 /wiki 索引和脚注)。
function storedToken(): string {
  return loadStoredSession()?.session_token ?? '';
}

// subscribeScopedRoots —— /wiki 索引根列表的渐进增强口。SSR 拿不到 token,只能列 published 的
// 那些;有 session 就按这位访客的 grant 重取一遍。无 token → no-op(SSR 的结果即最终)。
export function subscribeScopedRoots(
  onRoots: (nodes: TreeNode[]) => void,
): () => void {
  const token = storedToken();
  if (token === '') return () => {};
  let live = true;
  void fetchWikiTree('', token).then((nodes) => {
    if (live) onRoots(nodes);
  });
  return () => { live = false; };
}

// subscribeScopedStats —— 侧栏脚计数同理:GATED 那个数说的是**对这位访客**关着几条。
export function subscribeScopedStats(
  onStats: (stats: WikiTreeStats) => void,
): () => void {
  const token = storedToken();
  if (token === '') return () => {};
  let live = true;
  void fetchWikiTreeStats(token).then((stats) => {
    if (live) onStats(stats);
  });
  return () => { live = false; };
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
