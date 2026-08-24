// use-admin-tree-layer —— the admin lazy tree's per-level fetch effect (branching lives
// in lib, not the component). enabled + not-yet-fetched → fetch load(parentID) once and
// cache it; an epoch bump (any corpus mutation) drops the cache so the level refetches.
// Returns null while a level is unfetched / loading. Mirrors the public useTreeLayer but
// adds epoch invalidation (the public sidebar never mutates, so it has none).
//
// **作废必须能撤销一次在途的取**。以前 epoch 是靠一个 `setNodes(null)` 的 effect 表达的,
// 而 nodes **本来就是 null** 时 React 对同值 setState 直接 bail out —— 那一步于是什么也没做:
// 取还在路上、取回来的是新建之前的那份名单、落地之后 `nodes !== null` 就再也不取了。
// 屏幕上是「标题说 5 条、树上 4 行」,而且永远不会自己好(corpus-tree-epoch-inflight 钉的就是它)。
//
// 现在缓存**带着自己那一代的 epoch**:代次一变,读出来的就是 null(不需要任何 effect 生效),
// 取的那个 effect 也跟着重跑 —— 它的清理函数把上一代那笔标成作废,旧回参落地时被丢掉。

'use client';

import { useEffect, useState } from 'react';

interface Layer<T> {
  epoch: number;
  nodes: T[] | null;
}

export function useAdminTreeLayer<T>(
  load: (parentID: string) => Promise<T[]>,
  parentID: string, enabled: boolean, epoch: number,
): T[] | null {
  const [layer, setLayer] = useState<Layer<T>>({ epoch, nodes: null });
  // 别的代次取回来的东西不算数 —— 这一句是**推导**,不是一个要生效才成立的副作用。
  const nodes = layer.epoch === epoch ? layer.nodes : null;
  useEffect(() => {
    if (!enabled || nodes !== null) return undefined;
    let alive = true;
    void load(parentID).then((ns) => { if (alive) setLayer({ epoch, nodes: ns }); });
    return () => { alive = false; };
  }, [load, parentID, enabled, nodes, epoch]);
  return nodes;
}
