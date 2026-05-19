// use-handle —— owner 改 URL handle。
// PATCH /api/admin/handle；backend 在 handle_aliases 里留旧值，老链接仍可
// resolve（详见 internal/postgres/auth.go GetByHandle）。
//
// 合法 handle = `[a-z0-9-]{2,64}`（跟 backend usecases.UpdateOwnerHandle 对齐）。

import { useCallback, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface HandleHook {
  pending: boolean;
  error: string | null;
  update: (raw: string) => Promise<string | null>;
  clearError: () => void;
}

interface HandleResp { handle: string }

export function useHandle(): HandleHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (raw: string): Promise<string | null> => {
    setPending(true);
    setError(null);
    try {
      const res = await adminAPI.patch<HandleResp>('/handle', { handle: raw });
      return res.handle;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed');
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { pending, error, update, clearError };
}

const HANDLE_PATTERN = /^[a-z0-9-]{2,64}$/;

export function sanitizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidHandle(sanitized: string): boolean {
  return HANDLE_PATTERN.test(sanitized);
}

export interface HandleHint { cls: string; text: string }

export function handleHint(sanitized: string, current: string): HandleHint {
  const valid = isValidHandle(sanitized);
  const unchanged = sanitized === current;
  return !sanitized ? { cls: 'text-(--color-faint)', text: 'enter a new handle' }
    : !valid ? { cls: 'text-(--color-faint)', text: '2–64 chars · a–z 0–9 hyphen' }
    : unchanged ? { cls: 'text-(--color-faint)', text: 'no change' }
    : { cls: 'text-(--color-muted)', text: `old /${current} will keep resolving via alias` };
}

// canSaveHandle —— SaveBtn 是否可点：合法 + 已变 + 未在保存。把
// 分支条件挪到 lib，让 component 内复杂度 ≤ 3。
export function canSaveHandle(sanitized: string, current: string, pending: boolean): boolean {
  if (pending) return false;
  if (sanitized === current) return false;
  return isValidHandle(sanitized);
}

// pickHandle —— 拼有效 handle：override > sessionHandle > 兜底 'me'。
export function pickHandle(override: string | null, fromSession: string): string {
  return override ?? fromSession ?? 'me';
}

// commitHandle —— PATCH 调用 + 成功 callback；HandleEditor 直接调。
// onSuccess 让组件挂 toast（lib 不直接依赖 toast，避免循环 import）。
export async function commitHandle(
  sanitized: string,
  hook: HandleHook,
  onChanged: (h: string) => void,
  onClose: () => void,
  onSuccess: (h: string) => void,
): Promise<void> {
  const next = await hook.update(sanitized);
  if (next === null) return;
  onChanged(next);
  onClose();
  onSuccess(next);
}
