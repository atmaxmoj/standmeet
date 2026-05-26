// visitor-name.ts —— VisitorNamePicker 的 business logic / state derivation。
// 从 presentation 层挪出来：components/* 不准跑 `if` / 跑 dom-derived 逻辑。

import { useEffect, useState } from 'react';

import { useVisitorSessionStore } from '@/lib/visitor/session-store';

const DISMISS_KEY = 'standmeet-visitor-name-dismissed';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// useShouldAskVisitorName —— 决定 VisitorNamePicker 是不是要渲染。
// SSR 默认不弹（避免 hydration mismatch）；mount 后看 LS 是否 dismiss 过。
export function useShouldAskVisitorName(): boolean {
  const session = useVisitorSessionStore((s) => s.session);
  const [recentlyDismissed, setRD] = useState(true);
  useEffect(() => {
    setRD(checkRecentlyDismissed());
  }, []);
  return !recentlyDismissed && sessionNeedsName(session);
}

// submitNameAndStart —— PickerForm 提交：写 visitor 进 store + 留 dismiss
// timestamp（30 天内不再弹）。caller 负责设 going 状态做 "starting..." 动画。
export function submitNameAndStart(
  name: string,
  setVisitor: (n: string) => void,
): boolean {
  const trimmed = name.trim();
  if (trimmed === '') return false;
  setVisitor(trimmed);
  rememberDismiss();
  return true;
}

// dismissNamePicker —— "skip" 路径：visitor 留 "anonymous" 占位，server 端
// 当 null 算（visitor_name 字段不强校验）。
export function dismissNamePicker(setVisitor: (n: string) => void): void {
  setVisitor('anonymous');
  rememberDismiss();
}

function sessionNeedsName(
  session: ReturnType<typeof useVisitorSessionStore.getState>['session'],
): boolean {
  return Boolean(session)
    && (session?.visitor ?? '') === ''
    && ((session?.code ?? null) !== null || session?.byoai === true);
}

function rememberDismiss(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // LS 满 / 不可用 → silent。
  }
}

function checkRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = readDismiss();
  return raw !== null && Date.now() - raw < THIRTY_DAYS_MS;
}

function readDismiss(): number | null {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
