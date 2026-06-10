// use-lazy-tree —— LazyTree 的取数副作用(放 lib,组件层禁 if)。
//
// useTreeLayer(load, parentId, enabled):enabled 为 true 且本层还没取过时,取一次
// load(parentId) 那一层。enabled=false → 不取(懒加载:节点没展开就不碰它 children)。
// 取过就不再取(nodes 非 null 即缓存)。返回 null = 还没取/加载中。

'use client';

import { useEffect, useState } from 'react';

import type { TreeLoader, TreeNode } from '@/lib/corpus/tree';

export function useTreeLayer(
  load: TreeLoader, parentID: string, enabled: boolean,
): TreeNode[] | null {
  const [nodes, setNodes] = useState<TreeNode[] | null>(null);
  useEffect(() => {
    if (!enabled || nodes !== null) return undefined;
    let alive = true;
    void load(parentID).then((ns) => {
      if (alive) setNodes(ns);
    });
    return () => { alive = false; };
  }, [load, parentID, enabled, nodes]);
  return nodes;
}
