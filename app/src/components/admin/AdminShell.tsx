// AdminShell —— admin SPA chrome:TopBar + sidebar + main。
// session gating: useAdminSession 在 unauthed 时自动跳 /login。
//
// #34:挂在 app/admin/layout.tsx,跨 section 导航**不 remount**(Next layout
// 持久)—— sidebar 滚动 + 状态保住,不再每次点击 reset 到顶。active 高亮从
// usePathname 派生(layout 拿不到 page 的 active prop)。

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { ADMIN_SLUGS, type AdminSlug } from '@/lib/admin/nav';
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

// AdminLayout —— 顶栏 + 侧栏 + 正文。
//
// 窄屏上侧栏是**抽屉**，不是那 232px 的固定一列。理由是量出来的：390px 的屏上侧栏照旧占
// 232，正文只剩 158px —— 标题裁成 "dashboar"，统计卡片一行一两个字，`483` 从卡片里溢出来。
// 而这一切**没有任何横向溢出**（`scrollWidth === clientWidth`），所以每一条现成断言都是绿的：
// 元素没有超出视口，它们是被压扁的（[[text-assertion-cannot-see-layout]]）。
// 26 个分区全都这样，因为坏的是外壳，不是哪一页。
//
// `lg` 以上一个像素都没动 —— 功能套件跑在桌面尺寸，侧栏照旧是静态的一列。
function AdminLayout({
  active, handle, email, children,
}: {
  active: AdminSlug; handle: string; email: string; children: ReactNode;
}) {
  const badges = useSidebarBadges();
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((v) => !v), []);
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar handle={handle} email={email} navOpen={navOpen} onToggleNav={toggleNav} />
      <div className="flex-1 flex min-h-0">
        <AdminSidebar active={active} badges={badges} open={navOpen} onClose={closeNav} />
        {/* min-w-0：flex 子项默认 min-width:auto，正文里一张宽表格会把整列撑开而不是自己滚。 */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-12 py-6 lg:py-8 overflow-y-auto">
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
