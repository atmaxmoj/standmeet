// toast —— global transient notifications.
//
// Design language: fixed bottom-right, cream paper background, ink border, success uses muted,
// error uses the vermillion accent. No dependencies, plain React Context + setTimeout.
//
// Usage:
//   const toast = useToast();
//   toast.success('Handle updated');
//   toast.error('Domain verify failed');
//
// The whole app wraps <ToastProvider> once in the root layout, and mounts one <Toaster /> render area.

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

// useToastList —— lets the Toaster component read the current stack. Nothing else should use it.
function useToastList(): readonly ToastItem[] {
  return useContext(ToastListCtx);
}

// Toaster —— renders the panel. Needs the layout to mount it itself (not a portal, because our
// fixed positioning + z-index already aligns cleanly with the design chrome).
export function Toaster() {
  const items = useToastList();
  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 sm-z-toast flex flex-col gap-2 max-w-[24em]"
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

// useEffectErrorToast —— "overflows" an (err: string | null) state error into a toast.
// Used on hooks like use-domain / use-handle that keep their error in their own state:
// call useEffectErrorToast(hook.error), and a hook error automatically pops a toast.
export function useEffectErrorToast(error: string | null): void {
  const toast = useToast();
  useEffect(() => {
    error && toast.error(error);
  }, [error, toast]);
}
