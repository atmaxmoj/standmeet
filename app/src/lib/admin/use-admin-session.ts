// use-admin-session —— 探测当前是不是登录状态。GET /api/admin/me；
// 401 就跳 /login。Loading 期间显示 placeholder。
//
// zustand 重构：sessionStore 是全应用 /me cache。BYOAI / AI provider /
// admin session 三个 hook 都读它，避免每个 panel 各拉一次。

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { adminAPI, type MeView } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';

// AdminSession —— 旧 shape：sessionStore 全字段（MeView）的子集别名，
// 老 caller (AdminSidebar / PageSection / etc.) 还按这个 4 字段读。
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

export const sessionStore = createResourceStore<MeView>({
  name: 'admin-session',
  fetcher: () => adminAPI.get<MeView>('/me'),
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
  status: string, data: MeView | undefined,
): AdminSessionState {
  if (status === 'ready' && data) {
    return {
      kind: 'ready',
      session: {
        owner_id: data.owner.owner_id, email: data.owner.email,
        handle: data.owner.handle, full_name: data.owner.full_name,
      },
    };
  }
  if (status === 'error') return { kind: 'unauthed' };
  return { kind: 'loading' };
}
