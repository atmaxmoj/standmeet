// use-admin-tree-layer —— the admin lazy tree's per-level fetch effect (branching lives
// in lib, not the component). enabled + not-yet-fetched → fetch load(parentID) once and
// cache it; an epoch bump (any corpus mutation) drops the cache so the level refetches.
// Returns null while a level is unfetched / loading. Mirrors the public useTreeLayer but
// adds epoch invalidation (the public sidebar never mutates, so it has none).

'use client';

import { useEffect, useState } from 'react';

export function useAdminTreeLayer<T>(
  load: (parentID: string) => Promise<T[]>,
  parentID: string, enabled: boolean, epoch: number,
): T[] | null {
  const [nodes, setNodes] = useState<T[] | null>(null);
  useEffect(() => { setNodes(null); }, [epoch]);
  useEffect(() => {
    if (!enabled || nodes !== null) return undefined;
    let alive = true;
    void load(parentID).then((ns) => { if (alive) setNodes(ns); });
    return () => { alive = false; };
  }, [load, parentID, enabled, nodes]);
  return nodes;
}
