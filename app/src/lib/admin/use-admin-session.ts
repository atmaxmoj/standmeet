// use-admin-session —— 探测当前是不是登录状态。GET /api/admin/me；
// 401 就跳 /login。Loading 期间显示 placeholder。
//
// zustand 重构：sessionStore 是全应用 /me cache。BYOAI / AI provider /
// admin session 三个 hook 都读它，避免每个 panel 各拉一次。

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { adminAPI, MeViewSchema, type MeView } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

// AdminSession —— 旧 shape：sessionStore 全字段（MeView）的子集别名，
// 老 caller (AdminSidebar / PageSection / etc.) 还按这个 4 字段读。
export interface AdminSession {
  owner_id: string;
  email: string;
  handle: string;
  full_name: string;
  public_url: string;
}

// AdminSessionState —— `unreachable` 跟 `unauthed` 必须是两态（F-N-2）。
//
// 它们对 owner 的指示正好相反：401 = 去登录；5xx / 网络断 = 服务器不在，登录也没用。
// 以前两者都是 `unauthed`，于是一次后端停机被渲染成一张空的登录表单 —— owner 会以为
// 自己的密码出了问题，反复重输。**「你没登录」是一句关于世界的断言，它可能是假的。**
export type AdminSessionState =
  | { kind: 'loading' }
  | { kind: 'unauthed' }
  | { kind: 'unreachable' }
  | { kind: 'ready'; session: AdminSession };

export const sessionStore = createResourceStore<MeView>({
  name: 'admin-session',
  fetcher: () => adminAPI.get('/me', MeViewSchema),
});

export function useAdminSession(): AdminSessionState {
  const router = useRouter();
  const r = useResource(sessionStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  // 只有**真的没登录**才跳登录页。服务器不在的时候跳过去，给的是那条不管用的建议。
  useEffect(() => {
    if (r.status === 'error' && isUnauthed(r.errorStatus)) router.push('/login');
  }, [r.status, r.errorStatus, router]);
  return adminSessionFromResource(r.status, r.errorStatus, r.data);
}

// isUnauthed —— 401 / 403 才是「你没登录」。其余（5xx、网络断 → errorStatus 为 null）
// 都是「够不着服务器」。
function isUnauthed(errorStatus: number | null): boolean {
  return errorStatus === 401 || errorStatus === 403;
}

function adminSessionFromResource(
  status: string, errorStatus: number | null, data: MeView | undefined,
): AdminSessionState {
  if (status === 'error') {
    return isUnauthed(errorStatus) ? { kind: 'unauthed' } : { kind: 'unreachable' };
  }
  if (status === 'ready' && data) {
    return {
      kind: 'ready',
      session: {
        owner_id: data.owner.owner_id, email: data.owner.email,
        handle: data.owner.handle, full_name: data.owner.full_name,
        public_url: data.owner.public_url,
      },
    };
  }
  return { kind: 'loading' };
}
