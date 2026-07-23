// use-pinnable —— admin pin manager 的候选列表(GET /page/pinnable):published
// 的 wiki 条目(id/title/path)。pin 只能挑已发布条目(不变量 pinned ⊆ published
// 的写入端;后端 PUT /page 也会二次校验)。轻量 fetch-once,不上 resource store。

import { useEffect, useState } from 'react';

import { fetchPinnable, type PinnableEntry } from '@/lib/api/admin';

export function usePinnable(): readonly PinnableEntry[] {
  const [items, setItems] = useState<readonly PinnableEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchPinnable()
      .then((r) => { if (alive) setItems(r); })
      .catch(() => { /* 空候选:pin manager 提示先发布一条 */ });
    return () => { alive = false; };
  }, []);
  return items;
}
