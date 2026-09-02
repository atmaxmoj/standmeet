import { z } from 'zod';
// use-handle —— owner changes the URL handle.
// PATCH /api/admin/handle; the backend keeps the old value in handle_aliases,
// so old links still resolve (see internal/postgres/auth.go GetByHandle).
//
// A valid handle = `[a-z0-9-]{2,64}` (matches backend usecases.UpdateOwnerHandle).

import { useCallback, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface HandleHook {
  pending: boolean;
  error: string | null;
  update: (raw: string) => Promise<string | null>;
  clearError: () => void;
}

const HandleRespSchema = z.object({ handle: z.string() });

export function useHandle(): HandleHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (raw: string): Promise<string | null> => {
    setPending(true);
    setError(null);
    try {
      const res = await adminAPI.patch('/handle', { handle: raw }, HandleRespSchema);
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

// canSaveHandle —— whether SaveBtn is clickable: valid + changed + not
// currently saving. Branching moved to lib so the component's complexity stays ≤ 3.
export function canSaveHandle(sanitized: string, current: string, pending: boolean): boolean {
  if (pending) return false;
  if (sanitized === current) return false;
  return isValidHandle(sanitized);
}

// pickHandle —— assembles the effective handle: override > sessionHandle > fallback to 'me'.
export function pickHandle(override: string | null, fromSession: string): string {
  return override ?? fromSession ?? 'me';
}

// commitHandle —— the PATCH call + success callback; called directly by
// HandleEditor. onSuccess lets the component hang a toast off it (lib
// doesn't depend on toast directly, to avoid a circular import).
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
