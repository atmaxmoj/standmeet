// AdminShell —— admin SPA chrome:TopBar + sidebar + main。
// session gating: useAdminSession 在 unauthed 时自动跳 /login。
//
// #34:挂在 app/admin/layout.tsx,跨 section 导航**不 remount**(Next layout
// 持久)—— sidebar 滚动 + 状态保住,不再每次点击 reset 到顶。active 高亮从
// usePathname 派生(layout 拿不到 page 的 active prop)。

'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { AdminSidebar, type AdminSlug } from '@/components/admin/AdminSidebar';
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

const KNOWN_SLUGS: readonly AdminSlug[] = [
  'raw', 'wiki', 'output', 'conversations', 'codes', 'requests', 'connectors',
  'page', 'custom-pages', 'api-mcp', 'account', 'skills', 'writings', 'drafts',
  'applications', 'dashboard', 'sources', 'listings', 'seo', 'system',
  'preview', 'obsidian', 'agent-skills', 'roles', 'prompts', 'ip-bans',
];

// adminActiveSlug —— /admin/<slug>/… → slug;未知/缺省 → dashboard。no-if 走 find + ??。
function adminActiveSlug(pathname: string | null): AdminSlug {
  const seg = (pathname ?? '').replace(/^\/admin\/?/, '').split('/')[0];
  return KNOWN_SLUGS.find((s) => s === seg) ?? 'dashboard';
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

function Loading({ state }: { state: 'loading' | 'unauthed' }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <p className="mono text-(--color-muted)">
        {state === 'loading' ? 'loading admin…' : 'redirecting to /login…'}
      </p>
    </main>
  );
}
