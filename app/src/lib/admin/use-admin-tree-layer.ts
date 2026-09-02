// use-admin-tree-layer —— the admin lazy tree's per-level fetch effect (branching lives
// in lib, not the component). enabled + not-yet-fetched → fetch load(parentID) once and
// cache it; an epoch bump (any corpus mutation) drops the cache so the level refetches.
// Returns null while a level is unfetched / loading. Mirrors the public useTreeLayer but
// adds epoch invalidation (the public sidebar never mutates, so it has none).
//
// **Invalidation must be able to cancel a fetch already in flight.** The epoch
// used to be expressed via a `setNodes(null)` effect, and when nodes was
// **already null**, React bails out of a same-value setState — so that step
// did nothing: the fetch was still in flight, what it fetched was the list
// from before the mutation, and once it landed, `nodes !== null` meant it
// never fetched again. On screen: "header says 5, tree shows 4 rows", and it
// would never fix itself (this is exactly what corpus-tree-epoch-inflight pins down).
//
// The cache now **carries its own generation's epoch**: the moment the
// generation changes, reading it returns null (no effect needs to fire for
// that), and the fetch effect reruns along with it — its cleanup marks the
// previous generation's fetch as stale, so a late response is dropped on landing.

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
  // What a different generation fetched doesn't count — this line is a
  // **derivation**, not a side effect that requires firing to hold.
  const nodes = layer.epoch === epoch ? layer.nodes : null;
  useEffect(() => {
    if (!enabled || nodes !== null) return undefined;
    let alive = true;
    void load(parentID).then((ns) => { if (alive) setLayer({ epoch, nodes: ns }); });
    return () => { alive = false; };
  }, [load, parentID, enabled, nodes, epoch]);
  return nodes;
}
