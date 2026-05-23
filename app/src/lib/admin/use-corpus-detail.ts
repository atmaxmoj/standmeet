// use-corpus-detail —— EditForm 展开时 lazy-fetch 单条 entry 的 hook。
// 拿到 body 后回填，避免 owner 再手抄一遍。

'use client';

import { useEffect, useState } from 'react';

import type {
  CorpusActionsHook, OutputDetail, WikiDetail,
} from '@/lib/admin/use-corpus-actions';

export function useWikiDetail(id: string, actions: CorpusActionsHook): WikiDetail | null {
  const [detail, setDetail] = useState<WikiDetail | null>(null);
  useEffect(() => {
    let alive = true;
    void actions.fetchWikiDetail(id).then((d) => {
      if (alive) setDetail(d);
    });
    return () => { alive = false; };
  }, [id, actions]);
  return detail;
}

export function useOutputDetail(id: string, actions: CorpusActionsHook): OutputDetail | null {
  const [detail, setDetail] = useState<OutputDetail | null>(null);
  useEffect(() => {
    let alive = true;
    void actions.fetchOutputDetail(id).then((d) => {
      if (alive) setDetail(d);
    });
    return () => { alive = false; };
  }, [id, actions]);
  return detail;
}
