// use-public-url —— owner 改部署的 canonical public URL。
// PATCH /api/admin/public-url；backend 同款校验 + normalize（去末尾斜杠）。
//
// 合法 public URL：以 http:// 或 https:// 开头，host 非空。详细校验放
// backend；前端只挡明显错的（空 / 无 scheme），减少往返。

import { useCallback, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface PublicURLHook {
  pending: boolean;
  error: string | null;
  update: (raw: string) => Promise<string | null>;
  clearError: () => void;
}

interface PublicURLResp { public_url: string }

export function usePublicURL(): PublicURLHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (raw: string): Promise<string | null> => {
    setPending(true);
    setError(null);
    try {
      const res = await adminAPI.patch<PublicURLResp>('/public-url', { public_url: raw });
      return res.public_url;
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

const URL_PATTERN = /^https?:\/\/[^\s/]+/i;

export function sanitizePublicURL(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function isValidPublicURL(sanitized: string): boolean {
  return URL_PATTERN.test(sanitized);
}

export interface PublicURLHint { cls: string; text: string }

export function publicURLHint(sanitized: string, current: string): PublicURLHint {
  const valid = isValidPublicURL(sanitized);
  const unchanged = sanitized === current;
  return !sanitized ? { cls: 'text-(--color-faint)', text: 'paste the URL recruiters will see' }
    : !valid ? { cls: 'text-(--color-faint)', text: 'must start with http:// or https://' }
    : unchanged ? { cls: 'text-(--color-faint)', text: 'no change' }
    : { cls: 'text-(--color-muted)', text: 'QR codes + canonical tags will use this URL' };
}

export function canSavePublicURL(
  sanitized: string, current: string, pending: boolean,
): boolean {
  if (pending) return false;
  if (sanitized === current) return false;
  return isValidPublicURL(sanitized);
}

// commitPublicURL —— PATCH 调用 + 成功 callback；PublicURLEditor 直接调。
// onSuccess 让组件挂 toast（lib 不直接依赖 toast，避免循环 import）。
export async function commitPublicURL(
  sanitized: string,
  hook: PublicURLHook,
  onChanged: (u: string) => void,
  onClose: () => void,
  onSuccess: (u: string) => void,
): Promise<void> {
  const next = await hook.update(sanitized);
  if (next === null) return;
  onChanged(next);
  onClose();
  onSuccess(next);
}
