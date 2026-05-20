// use-admin-session —— 探测当前是不是登录状态。GET /api/admin/me；
// 401 就跳 /login。Loading 期间显示 placeholder。
//
// zustand 重构：sessionStore 共享 owner profile，多个 section 不再各拉一次。

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';

export interface AdminSession {
  owner_id: string;
  email: string;
  handle: string;
  full_name: string;
}

export type AdminSessionState =
  | { kind: 'loading' }
  | { kind: 'unauthed' }
  | { kind: 'ready'; session: AdminSession };

export const sessionStore = createResourceStore<AdminSession>({
  name: 'admin-session',
  fetcher: () => adminAPI.get<AdminSession>('/me'),
});

export function useAdminSession(): AdminSessionState {
  const router = useRouter();
  const r = readResource(sessionStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  useEffect(() => {
    if (r.status === 'error') router.push('/login');
  }, [r.status, router]);
  return adminSessionFromResource(r.status, r.data);
}

function adminSessionFromResource(
  status: string, data: AdminSession | undefined,
): AdminSessionState {
  if (status === 'ready' && data) return { kind: 'ready', session: data };
  if (status === 'error') return { kind: 'unauthed' };
  return { kind: 'loading' };
}
