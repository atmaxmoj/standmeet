// load-wiki-children —— the wiki data port for LazyTree. Each time a level
// is fetched, it reads the current stored session token (with a code →
// send it along for role scope; without one → anonymous, published only)
// and hands off to fetchWikiTree. Logic lives in lib (the components layer
// bans if).

import { fetchWikiContext, fetchWikiTree, fetchWikiTreeStats } from '@/lib/api/public';
import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeNode } from '@/lib/corpus/tree';
import { loadStoredSession } from '@/lib/gate/use-gate';

export function loadWikiChildren(parentID: string): Promise<TreeNode[]> {
  const token = loadStoredSession()?.session_token ?? '';
  return fetchWikiTree(parentID, token);
}

// storedToken —— the visitor's session token only lives in the browser;
// SSR can't see it. This is why every place where "an invited visitor
// should see more" needs a client-side follow-up fetch (F-L-11's reader,
// F-L-13's child-entry sidebar, and now F-L-14's /wiki index and footer
// stats).
function storedToken(): string {
  return loadStoredSession()?.session_token ?? '';
}

// subscribeScopedRoots —— the progressive-enhancement port for the /wiki
// index's root list. SSR has no token, so it can only list the published
// ones; if there's a session, refetch once with this visitor's grant. No
// token → no-op (the SSR result is final).
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

// subscribeScopedStats —— same idea for the sidebar footer count: the
// GATED number tells how many entries are closed **to this visitor**.
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

// subscribeScopedChildren —— the progressive-enhancement port for F-L-13's
// reader child-entry sidebar: only when there's a stored session token does
// it refetch context children with the visitor's scope (filling in gated
// children that SSR-anonymous couldn't see), handing results to the
// callback. No token → no-op (the SSR published children are final).
// Returns a cleanup that cancels the in-flight request (guards against
// setState-after-unmount on unmount / slug change). Logic lives in lib:
// the presentation layer bans `if`, the component effect just returns this
// one subscription.
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
