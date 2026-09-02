// use-pinnable —— candidate list for the admin pin manager (GET /page/pinnable):
// published wiki entries (id/title/path). pin can only choose published entries
// (the write side of the invariant pinned ⊆ published; the backend PUT /page
// also re-validates it). Lightweight fetch-once, not backed by a resource store.

import { useEffect, useState } from 'react';

import { fetchPinnable, type PinnableEntry } from '@/lib/api/admin';

export function usePinnable(): readonly PinnableEntry[] {
  const [items, setItems] = useState<readonly PinnableEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchPinnable()
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { /* empty candidate list: the pin manager prompts to publish one first */ });
    return () => { alive = false; };
  }, []);
  return items;
}
