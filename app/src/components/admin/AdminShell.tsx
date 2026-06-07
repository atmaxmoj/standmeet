// AdminShell —— admin SPA chrome：TopBar + sidebar + main。
// session gating: useAdminSession 在 unauthed 时自动跳 /login。

'use client';

import type { ReactNode } from 'react';

import { AdminSidebar, type AdminSlug } from '@/components/admin/AdminSidebar';
import { TopBar } from '@/components/admin/chrome/TopBar';

import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useSidebarBadges } from '@/lib/admin/use-sidebar-badges';

type Props = {
  active: AdminSlug;
  children: ReactNode;
};

export function AdminShell({ active, children }: Props) {
  const session = useAdminSession();
  return session.kind === 'ready'
    ? <AdminLayout active={active} handle={session.session.handle} email={session.session.email}>{children}</AdminLayout>
    : <Loading state={session.kind} />;
}

function AdminLayout({
  active, handle, email, children,
}: {
  active: AdminSlug; handle: string; email: string; children: ReactNode;
}) {
  const badges = useSidebarBadges();
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar handle={handle} email={email} />
      <div className="flex-1 flex min-h-0">
        <AdminSidebar active={active} badges={badges} />
        <main className="flex-1 px-8 lg:px-12 py-8 overflow-y-auto">
          <div className="max-w-[1200px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Loading({ state }: { state: 'loading' | 'unauthed' }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="mono text-(--color-muted)">
        {state === 'loading' ? 'loading admin…' : 'redirecting to /login…'}
      </p>
    </main>
  );
}
