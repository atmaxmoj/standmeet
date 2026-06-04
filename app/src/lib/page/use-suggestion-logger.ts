// use-suggestion-logger —— H.13.e: visitor 浏览器把 ghost text shown +
// accept 日志写到 backend，admin 详情页能看每 turn 推了什么、是否被接受。
//
// 行为:
//   - watch useCurrentGhostMeta() — ghost text 变了 (初始 seed / cycle /
//     SSE 追加都触发) → POST /api/v1/sessions/{conv_id}/suggestions/shown
//     → 拿回 row id 存 store (markShown)
//   - acceptCurrent() — Tab 触发；按 store 里最近 shown 的 text 反查 id
//     → POST .../suggestions/{sid}/accept (204)
//
// non-code mode visitor 永远 ghost = null → 不发请求；同套代码兼容三种 mode。
//
// session 信息走 loadStoredSession (localStorage)；useChat 的 ensureSession
// 只有 ask 时才跑，但 ghost 在 ask 前就要渲，所以走 storage 不走 sessionRef。
//
// 重复抑制走 store 而不是组件局部 ref：mode 切换 (LongScroll → ChatRoom)
// 时 hook 重 mount，局部 ref 都重置 → 同一 ghost 会被 POST 第二次。store
// 是 cross-instance，shownIDs[text] 已经有就跳过。

'use client';

import { useCallback, useEffect } from 'react';

import { loadStoredSession } from '@/lib/gate/use-gate';
import {
  useCurrentGhostMeta, useSuggestionsStore, type SuggestionSource,
} from '@/lib/visitor/suggestions-store';

export interface SuggestionLogger {
  // acceptCurrent —— Tab 时调；按 current ghost text 在 store shownIDs
  // 找对应 row id 调 backend accept。还没 shown response 回来 → noop。
  acceptCurrent: () => void;
}

export function useSuggestionLogger(): SuggestionLogger {
  const meta = useCurrentGhostMeta();

  useEffect(() => {
    if (meta === null) return;
    void recordShown(meta.text, meta.source);
  }, [meta]);

  const acceptCurrent = useCallback(() => {
    if (meta === null) return;
    const id = useSuggestionsStore.getState().shownIDs[meta.text];
    if (id === undefined) return;
    void recordAccept(id);
  }, [meta]);

  return { acceptCurrent };
}

async function recordShown(text: string, source: SuggestionSource): Promise<void> {
  // store-level dedup：text 已有 id 不再发；多实例 mount (LongScroll →
  // ChatRoom switch) 都跑同样代码也只一次落 row。
  if (useSuggestionsStore.getState().shownIDs[text] !== undefined) return;
  const sess = loadStoredSession();
  if (sess === null) return;
  const res = await fetch(
    `/api/v1/sessions/${sess.conversation_id}/suggestions/shown`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session_token}`,
      },
      body: JSON.stringify({ ghost_text: text, source, turn_index: 0 }),
    },
  );
  if (!res.ok) return;
  const body: unknown = await res.json();
  const id = pickShownID(body);
  if (id !== null) useSuggestionsStore.getState().markShown(text, id);
}

async function recordAccept(id: string): Promise<void> {
  const sess = loadStoredSession();
  if (sess === null) return;
  await fetch(
    `/api/v1/sessions/${sess.conversation_id}/suggestions/${id}/accept`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${sess.session_token}` },
    },
  );
}

function pickShownID(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const v = body['id'];
  return typeof v === 'string' && v !== '' ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
