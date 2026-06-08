// use-absorb-code —— visitor 带着 `?code=ABC` 进站时的入口。
//
// mount 一次:把 URL 上的 code 吸进 usePendingCodeStore + 立刻
// history.replaceState 删 query(明文不留在 URL / history / 截图 / referer 上)。
//
// **不在这里 issue session**(defer-issue):扫码只先存下 code;由名字选择器
// (use-issue-pending-code)等 visitor 选好名字后才真正 issueCodeSession ——
// 这样名字真的进后端 = 一个人一个具名 member = 一段续聊的会。skip 也走那条
// (匿名 issue)。
//
// 安全:URL 上 `?code=` 不安全(截图/分享/referer/history 全会泄漏纯码),
// 所以入口立刻 replaceState 删掉,code 暂存进内存 store。

'use client';

import { useEffect } from 'react';

import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { clearNameDismiss } from '@/lib/visitor/visitor-name';

export function useAbsorbCodeFromURL(): void {
  useEffect(() => {
    absorbFromURL();
  }, []);
}

// absorbFromURL —— 仅一次:读 location.search 里的 code,set 进 pending store,
// 然后 history.replaceState 把 query 上的 code 删掉(保留其它 query/hash)。
function absorbFromURL(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (code === null || code === '') return;
  usePendingCodeStore.getState().setCode(code);
  // 新 code(扫 QR / 点分享链接)= 新场景 → 清掉上次 skip 的 30 天 dismiss,
  // 让 VisitorNamePicker 重新问名字。
  clearNameDismiss();
  url.searchParams.delete('code');
  const rest = url.searchParams.toString();
  const next = url.pathname + (rest ? `?${rest}` : '') + url.hash;
  window.history.replaceState(null, '', next);
}
