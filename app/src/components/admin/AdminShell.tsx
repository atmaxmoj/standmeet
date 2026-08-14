// AdminShell —— admin SPA chrome:TopBar + sidebar + main。
// session gating: useAdminSession 在 unauthed 时自动跳 /login。
//
// #34:挂在 app/admin/layout.tsx,跨 section 导航**不 remount**(Next layout
// 持久)—— sidebar 滚动 + 状态保住,不再每次点击 reset 到顶。active 高亮从
// usePathname 派生(layout 拿不到 page 的 active prop)。

'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { ADMIN_SLUGS, AdminSidebar, type AdminSlug } from '@/components/admin/AdminSidebar';
import { TopBar } from '@/components/admin/chrome/TopBar';

import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useSidebarBadges } from '@/lib/admin/use-sidebar-badges';

type Props = {
  children: ReactNode;
};

export function AdminShell({ children }: Props) {
  const session = useAdminSession();
  const active = adminActiveSlug(usePathname());
  return session.kind === 'ready'
    ? <AdminLayout active={active} handle={session.session.handle} email={session.session.email}>{children}</AdminLayout>
    : <Loading state={session.kind} />;
}

// adminActiveSlug —— /admin/<slug>/… → slug;未知/缺省 → dashboard。no-if 走 find + ??。
//
// 认哪些 slug 由**侧栏自己**说了算（`ADMIN_SLUGS` 从 `NAV_GROUPS` 算出来）。
// 这里原本抄了第二份清单，而那份漏了 `subjectivity` —— 侧栏渲得出那一节，
// 路径映射却不认识它，于是那一页高亮的是 dashboard（F-N-1）。一份事实，一个来源。
function adminActiveSlug(pathname: string | null): AdminSlug {
  const seg = (pathname ?? '').replace(/^\/admin\/?/, '').split('/')[0];
  return ADMIN_SLUGS.find((s) => s === seg) ?? 'dashboard';
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
          {/* Fills a normal large office screen (27–32" QHD→4K); not 49"/57" ultrawides. */}
          <div className="max-w-[2400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

// Loading —— 三种非 ready 态各说各的话。**`unreachable` 不是 `unauthed`**（F-N-2）：
// 后端停机时把 owner 送去登录页，等于让他反复输一个没问题的密码。这里说清楚发生了什么，
// 以及为什么现在登录也没用。
function Loading({ state }: { state: 'loading' | 'unauthed' | 'unreachable' }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="mono text-(--color-muted)">{LOADING_COPY[state]}</p>
    </main>
  );
}

const LOADING_COPY: Record<'loading' | 'unauthed' | 'unreachable', string> = {
  loading: 'loading admin…',
  unauthed: 'redirecting to /login…',
  unreachable: 'couldn’t reach the server — your session is fine, the instance is not '
    + 'answering. Signing in again will not help; retry once it is back.',
};
