import { z } from 'zod';
// use-public-url —— owner changes the deployment's canonical public URL.
// PATCH /api/admin/public-url; the backend runs the matching validation +
// normalize (strips trailing slash).
//
// A valid public URL: starts with http:// or https://, host non-empty.
// Detailed validation lives on the backend; the frontend only blocks the
// obviously wrong (empty / no scheme) to cut down on round trips.

import { useCallback, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';

export interface PublicURLHook {
  pending: boolean;
  error: string | null;
  update: (raw: string) => Promise<string | null>;
  clearError: () => void;
}

const PublicURLRespSchema = z.object({ public_url: z.string() });

export function usePublicURL(): PublicURLHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (raw: string): Promise<string | null> => {
    setPending(true);
    setError(null);
    try {
      const res = await adminAPI.patch('/public-url', { public_url: raw }, PublicURLRespSchema);
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

// commitPublicURL —— the PATCH call + success callback; called directly by
// PublicURLEditor. onSuccess lets the component hang a toast off it (lib
// doesn't depend on toast directly, to avoid a circular import).
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
