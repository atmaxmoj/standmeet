// toast —— 全局短暂通知。
//
// 设计语言：fixed bottom-right、cream paper 背景、ink 边、success 用 muted、
// error 用 vermillion accent。无依赖，纯 React Context + setTimeout。
//
// 使用：
//   const toast = useToast();
//   toast.success('Handle updated');
//   toast.error('Domain verify failed');
//
// 整个 app 在 root layout 里包一次 <ToastProvider>，挂一个 <Toaster /> 渲染区。

'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastAPI {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastCtx = createContext<ToastAPI | null>(null);
const ToastListCtx = createContext<readonly ToastItem[]>([]);

const TTL_MS = 4_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextID = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextID.current++;
    setItems((cur) => [...cur, { id, kind, text }]);
    setTimeout(() => dismiss(id), TTL_MS);
  }, [dismiss]);

  const api = useMemo<ToastAPI>(() => ({
    success: (t) => push('success', t),
    error:   (t) => push('error', t),
    info:    (t) => push('info', t),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      <ToastListCtx.Provider value={items}>
        {children}
      </ToastListCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastCtx);
  return ctx ?? noopToast;
}

const noopToast: ToastAPI = {
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
};

// useToastList —— 给 Toaster 组件读当前 stack。其他人不该用。
export function useToastList(): readonly ToastItem[] {
  return useContext(ToastListCtx);
}

// Toaster —— 渲染面板。需要 layout 自己挂一次（不是 portal，因为我们的
// fixed positioning + z-index 跟设计 chrome 干净对齐就够）。
export function Toaster() {
  const items = useToastList();
  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-[24em]"
      data-testid="toaster"
    >
      {items.map((t) => <ToastCard key={t.id} item={t} />)}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const cls = toneClass(item.kind);
  return (
    <div
      role="status"
      data-testid={`toast-${item.kind}`}
      className={`border ${cls} bg-(--color-paper) px-4 py-3 rounded-sm shadow-sm reading-tight text-[14px] text-(--color-ink)`}
    >
      <span className="mono text-[10px] tracking-[0.16em] uppercase mr-2 align-middle">
        {kindLabel(item.kind)}
      </span>
      <span className="align-middle">{item.text}</span>
    </div>
  );
}

function toneClass(kind: ToastKind): string {
  return kind === 'error' ? 'border-(--color-accent)'
    : kind === 'success' ? 'border-(--color-ink)'
    : 'border-(--color-rule)';
}

function kindLabel(kind: ToastKind): string {
  return kind === 'error' ? '✗ err'
    : kind === 'success' ? '✓ ok'
    : '· note';
}

// useEffectErrorToast —— 把一个 (err: string | null) state 错误"溢出"成 toast。
// 用在 use-domain / use-handle 这种把 error 留在自己 state 里的 hook 上：
// 调用 useEffectErrorToast(hook.error)，hook 报错就自动弹 toast。
export function useEffectErrorToast(error: string | null): void {
  const toast = useToast();
  useEffect(() => {
    error && toast.error(error);
  }, [error, toast]);
}
