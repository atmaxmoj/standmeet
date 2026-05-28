// use-absorb-code —— visitor 落 `/?code=ABC` 时的两步入口：
//   1. mount: 把 URL 上 `?code=` 抽进 usePendingCodeStore + history.replaceState
//      立刻删 query（明文不留在 URL / history / 截图 / referer 上）
//   2. effect: store 里有 pending code → 调 issueCodeSession 拿 session_token →
//      persistSession 写进 localStorage → clear store
//
// 调用方：任何 visitor 能落地 + 能 chat 的 client component（page-shell 等），
// 一次就够。失败（code 无效 / 过期）保持 public mode，URL 还是已经清掉。
//
// 已有 stored session 时仍然消费 URL 上的 code —— recruiter 重新扫 QR /
// 换 code 是有效场景；老 session 会被 server 端 issue 时换发的新 token 覆盖。

'use client';

import { useEffect } from 'react';

import { issueCodeSession } from '@/lib/api/public';
import { persistSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

// useAbsorbCodeFromURL —— mount 一次：URL → store + 立刻 replaceState；
// 然后订阅 store 里的 pending code 自动 issue + persist。
// onConsumed 在 session 落 localStorage 之后回调，让宿主重读 stored mode
// （PageShell 用来把 mode 从 'public' 切到 'code'）。
export function useAbsorbCodeFromURL(onConsumed?: () => void): void {
  useEffect(() => {
    absorbFromURL();
  }, []);

  const pending = usePendingCodeStore((s) => s.code);
  const consume = usePendingCodeStore((s) => s.consume);

  useEffect(() => {
    if (pending === null) return;
    void (async () => {
      try {
        const sess = await issueCodeSession({ code: pending });
        persistSession(sess, false);
        useVisitorSessionStore.getState().setSession({
          code: sess.code ?? pending,
          visitor: sess.visitor_name ?? null,
          byoai: false,
          byoaiProvider: '',
          label: null,
          used: sess.quota?.used_turns ?? 0,
          max: sess.quota?.max_turns ?? 0,
          startedAt: Date.now(),
        });
        onConsumed?.();
      } catch {
        // code 无效 / 过期：URL 已清，悄悄回落 public mode；
        // 后续 visitor 走 /gate 手输 / 重扫。
      } finally {
        consume();
      }
    })();
  }, [pending, consume, onConsumed]);
}

// absorbFromURL —— 仅一次：读 location.search 里的 code，set 进 store，
// 然后 history.replaceState 把 query 上的 code 删掉（保留其它 query/hash）。
function absorbFromURL(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (code === null || code === '') return;
  // 先 set 再 replaceState：先存 store 拿到 React 队列，再清 URL；这样即使
  // replaceState 触发 router 重 render，code 已经在 store 里。
  usePendingCodeStore.getState().setCode(code);
  url.searchParams.delete('code');
  const rest = url.searchParams.toString();
  const next = url.pathname + (rest ? `?${rest}` : '') + url.hash;
  window.history.replaceState(null, '', next);
}
