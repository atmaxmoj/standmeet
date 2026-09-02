// use-lazy-tree —— LazyTree's data-fetching side effect (lives in lib; the
// component layer is not allowed conditional fetch logic).
//
// useTreeLayer(load, parentId, enabled): when enabled is true and this layer
// hasn't been fetched yet, fetches load(parentId) once. enabled=false → don't
// fetch (lazy loading: an unexpanded node's children are left untouched).
// Once fetched, never fetched again (nodes non-null means cached). Returns
// null = not yet fetched / still loading.

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
