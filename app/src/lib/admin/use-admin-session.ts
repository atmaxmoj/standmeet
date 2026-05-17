// use-admin-session —— 探测当前是不是登录状态。GET /api/admin/me；
// 401 就跳 /login。Loading 期间显示 placeholder。

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { adminAPI } from '@/lib/api/admin';

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

export function useAdminSession(): AdminSessionState {
  const router = useRouter();
  const [state, setState] = useState<AdminSessionState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void probeSession(cancelled, setState, router);
    return () => { cancelled = true; };
  }, [router]);
  return state;
}

async function probeSession(
  cancelled: boolean,
  setState: (s: AdminSessionState) => void,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  try {
    const session = await adminAPI.get<AdminSession>('/me');
    cancelled || setState({ kind: 'ready', session });
  } catch {
    cancelled || setState({ kind: 'unauthed' });
    router.push('/login');
  }
}
