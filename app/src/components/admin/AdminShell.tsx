// AdminShell —— admin SPA 的 chrome：sidebar nav + 内容区。
//
// 6 sections + tokens：raw / wiki / conversations / codes / connectors /
// page / api·mcp。访问 /admin/<slug>。session check 通过后渲染 children。
// 未登录由 useAdminSession 自动跳 /login。

'use client';

import type { ReactNode } from 'react';

import { AdminSidebar, type AdminSlug } from './AdminSidebar';

import { useAdminSession } from '@/lib/admin/use-admin-session';

type Props = {
  active: AdminSlug;
  children: ReactNode;
};

export function AdminShell({ active, children }: Props) {
  const session = useAdminSession();
  return session.kind === 'ready'
    ? <AdminShellLayout active={active} handle={session.session.handle}>{children}</AdminShellLayout>
    : <AdminShellLoading state={session.kind} />;
}

function AdminShellLayout({
  active, handle, children,
}: { active: AdminSlug; handle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr]">
      <AdminSidebar active={active} handle={handle} />
      <main className="px-10 py-12 max-w-3xl">{children}</main>
    </div>
  );
}

function AdminShellLoading({ state }: { state: 'loading' | 'unauthed' }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="mono text-(--color-muted)">
        {state === 'loading' ? 'loading admin…' : 'redirecting to /login…'}
      </p>
    </main>
  );
}
