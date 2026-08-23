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

import { loadStoredSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { codeLandingHref } from '@/lib/visitor/code-landing';
import { peekStoredSession } from '@/lib/visitor/session-store';
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
  // F-A-5: 已经在这张**同一码**的具名 session 里(via /gate 或上次选过名字)= visitor
  // 已解析 → 重开 ?code= 链接不该再弹身份选择器盖在活跃会话上。仍然把 code 从 URL 剥掉。
  if (!alreadyInNamedSession(code)) {
    usePendingCodeStore.getState().setCode(code);
    // 新 code(扫 QR / 点分享链接)= 新场景 → 清掉上次 skip 的 30 天 dismiss,
    // 让 VisitorNamePicker 重新问名字。
    clearNameDismiss();
  }
  url.searchParams.delete('code');
  const rest = url.searchParams.toString();
  const next = url.pathname + (rest ? `?${rest}` : '') + url.hash;
  window.history.replaceState(null, '', next);
  landOnRendering(code);
}

// landOnRendering —— 第二次打开同一条链接（已经在这张码的具名会话里，上面那一支
// 早退了、不会再颁发一次）也要落到这张码的页上。
//
// 落地在颁发那一刻存进了 session，所以这里读的是同一个事实，不是另算一遍。
// **漏掉这一支的话，缺陷只在「回访」时出现**：第一次扫码好好的，第二次点同一个链接
// 落在默认对话上 —— 而 owner 手上只有一张码，试一次是试不出来的。
function landOnRendering(code: string): void {
  if (!alreadyInNamedSession(code)) return;
  const href = codeLandingHref(loadStoredSession()?.custom_page_slug ?? '');
  if (href === '' || window.location.pathname === href) return;
  window.location.assign(href);
}

// alreadyInNamedSession —— 当前是否已有一张**同码且已具名**的活跃 session。
// peekStoredSession 直接同步读 LS,绕开 zustand hydrate 时序(与 absorb effect 同 mount)。
function alreadyInNamedSession(code: string): boolean {
  const active = peekStoredSession();
  return active?.code === code && Boolean(active?.visitor);
}
