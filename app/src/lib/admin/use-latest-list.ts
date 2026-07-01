// use-latest-list —— GET 一个 `{ connectors: T[] }` 端点成列表，**最新赢** + loaded。use-connector-list
// （owner 已建）与 use-connector-catalog（内置目录）共用这一份 fetch 逻辑，不各写一份（dim-3 单源）。
// 最新赢（dim-7）：refresh 常被 create/remove 连着触发，前一发在飞时后一发已发出——响应乱序回来会
// 用旧列表盖掉新列表。只认最后一发的响应（连接器 Hub 竞态的前端同构）。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';

import { adminAPI } from '@/lib/api/admin';

interface LatestList<T> {
  items: readonly T[];
  loaded: boolean;
  refresh: () => void;
}

export function useLatestList<T>(
  path: string, schema: ZodType<{ connectors?: T[] | null }>,
): LatestList<T> {
  const [items, setItems] = useState<readonly T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++seq.current;
    void adminAPI.get(path, schema)
      .then((r) => { if (mine === seq.current) { setItems(r.connectors ?? []); setLoaded(true); } })
      .catch(() => { if (mine === seq.current) { setLoaded(true); } });
  }, [path, schema]);

  useEffect(() => { refresh(); }, [refresh]);
  return { items, loaded, refresh };
}
