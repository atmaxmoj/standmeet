// AdminSidebar —— admin 左侧 nav。design 源 admin.js Sidebar +
// NAV_GROUPS (27-62)。mono 11.5px nav-link + "── group" headers + accent
// badge 动态计数。border-left accent 标 active。
//
// 每一节叫什么在 `lib/admin/nav` 里写一次 —— 侧栏的牌子和门后的大标题读的是同一份（F-N-3）。

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { SystemPulse } from '@/components/admin/chrome/SystemPulse';
import { NAV_GROUPS, type AdminSlug, type NavGroup, type SectionDef } from '@/lib/admin/nav';
import { sidebarBadgeFor } from '@/lib/admin/sidebar-badge-for';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useAppVersion } from '@/lib/app-version';
import { deployView, useSystemInfo } from '@/lib/admin/use-system-info';

export interface SidebarBadges {
  raw?: number;
  requests?: number;
  listings?: number;
}

type Props = {
  active: AdminSlug;
  badges?: SidebarBadges;
  // open / onClose —— 只在 `lg` 以下有意义（那时它是抽屉）。桌面上侧栏恒在，两者不参与。
  open?: boolean;
  onClose?: () => void;
};

// 窄屏上这一列**脱离文档流**（`max-lg:fixed`）。用 translate 藏起来是不够的：
// 它仍是 flex 行里 `w-[232px] shrink-0` 的一项，宽度照占，正文照样只剩 158px ——
// 看不见了，却还在挤，而那正是要修的那件事。
const SHELL = 'w-[232px] shrink-0 border-r border-(--color-rule) pb-5 flex flex-col overflow-y-auto';
// 层级走 globals.css 那张表的 `overlay` 带（半屏遮罩），抽屉压着自己那层遮罩：
// `overlay-1` 是遮罩、`overlay-2` 是面板。**不往上挪**到 modal / toast 那两带 ——
// 抽屉开着时弹的 toast 仍然要看得见（F-C-26 就是被这个次序坑的）。
//
// `sm-z-overlay-2` 不带 `max-lg:`：那是 Tailwind 的变体，套不到这个手写 CSS 类上
// （写了不报错，只是不生成任何东西）。不加限制也没有副作用 —— 桌面上这一列是 `static`，
// z-index 对 static 元素本来就不生效。
const DRAWER = 'sm-z-overlay-2 max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 '
  + 'max-lg:w-[min(19rem,85vw)] max-lg:bg-(--color-paper) max-lg:shadow-xl '
  + 'max-lg:transition-transform max-lg:duration-200';
// 关着时用 `invisible` 而不是 `aria-hidden`：关着的抽屉对读屏和 Tab 也该是关着的
// （只用 translate 挪走的话，焦点还能走进一列看不见的链接，而人不知道自己去了哪），
// 但 `aria-hidden` 是个属性、没有断点，写上去会把**桌面上那列常驻的侧栏**一起藏掉。
// `visibility` 同时管无障碍树和 Tab 序，而且能按断点切换，正好是这里要的那一个。
const CLOSED = 'max-lg:-translate-x-full max-lg:invisible lg:visible';

export function AdminSidebar({ active, badges, open = false, onClose }: Props) {
  return (
    <>
      {open ? <Scrim onClose={onClose} /> : null}
      <nav
        id="admin-sidebar"
        data-testid="admin-sidebar"
        // 抽屉里点了任何一条就收起来 —— 冒泡到这里,不用给每个 item 传一遍。
        //
        // 挂在这儿而不是「路由变了就收」:后者在**重复点当前这一节**时不触发
        // （`active` 没变),于是抽屉留在原地盖着正文,而人刚刚做的动作是"我要去看它"。
        // 桌面上 onClose 是 undefined,这一行什么都不做。
        onClick={onClose}
        className={navCls(open)}
      >
        <SystemPulse />
        <Groups active={active} badges={badges} />
        <SidebarFooter />
      </nav>
    </>
  );
}

function navCls(open: boolean): string {
  return `${SHELL} ${DRAWER} ${open ? 'max-lg:translate-x-0' : CLOSED}`;
}

// Scrim —— 抽屉后面那层。它同时是**点外面关掉**那个动作：手机上没有别的地方可点。
function Scrim({ onClose }: { onClose?: () => void }) {
  const t = useTranslations('adminShell.sidebar');
  return (
    <button
      type="button"
      aria-label={t('closeNav')}
      onClick={onClose}
      className="lg:hidden fixed inset-x-0 bottom-0 top-14 sm-z-overlay-1 bg-(--color-ink)/25"
    />
  );
}

function Groups({ active, badges }: { active: AdminSlug; badges?: SidebarBadges }) {
  return (
    <div className="flex flex-col">
      {NAV_GROUPS.map((g) => <Group key={g.label} group={g} active={active} badges={badges} />)}
    </div>
  );
}

function Group({ group, active, badges }: { group: NavGroup; active: AdminSlug; badges?: SidebarBadges }) {
  const t = useTranslations('adminShell.sidebar');
  return (
    <div className="py-1.5">
      <div className="mono text-[9.5px] tracking-[0.22em] uppercase text-(--color-faint) px-4 py-1">
        {t('groupPrefix')} {group.label}
      </div>
      {group.items.map((s) => (
        <SidebarItem key={s.slug} section={s} active={s.slug === active} badge={sidebarBadgeFor(s.slug, badges)} />
      ))}
    </div>
  );
}


function SidebarItem({ section, active, badge }: { section: SectionDef; active: boolean; badge: number | null }) {
  return (
    <Link
      href={`/admin/${section.slug}`}
      className={navLinkCls(active)}
      aria-current={active ? 'page' : undefined}
    >
      <span data-testid={`admin-nav-${section.slug}`} className="flex-1">{section.label}</span>
      <Badge count={badge} testId={section.badgeTestId} />
    </Link>
  );
}

function navLinkCls(active: boolean): string {
  const base = 'flex items-baseline gap-2.5 px-4 py-[5px] mono text-[11.5px] tracking-[0.04em] cursor-pointer border-l-2 transition-colors';
  return active
    ? `${base} text-(--color-ink) border-l-(--color-accent) bg-(--color-surface)`
    : `${base} text-(--color-muted) border-l-transparent hover:text-(--color-ink) hover:bg-(--color-surface)/50`;
}

function Badge({ count, testId }: { count: number | null; testId?: string }) {
  return count !== null ? (
    <span
      data-testid={testId}
      className="ml-auto mono text-[9px] tracking-[0.06em] text-(--color-accent) tabular-nums"
    >
      {count}
    </span>
  ) : null;
}

// SidebarFooter —— 这两行 owner 在 admin 每一页都看得见,所以两行都必须是关于**这台**机器的。
// 上一版是 `instance · standmeet`(i18n 常量:每台实例都这么写,于是它谁也没说)加
// `uptime · —`(横杠是 JSX 字面量)。而 /admin/system 同一时刻显示着真的 uptime —— 值一直
// 在,只是没接过来。现在两处读同一个 system-info store,不可能再各说各的(UX-27)。
function SidebarFooter() {
  const t = useTranslations('adminShell.sidebar');
  const { info } = useSystemInfo();
  const session = useAdminSession();
  const handle = session.kind === 'ready' ? session.session.handle : '';
  return (
    <div className="mt-auto px-4 pt-4 border-t border-(--color-rule) mono text-[9.5px] tracking-[0.06em] text-(--color-faint) leading-[1.6]">
      <div>
        {t('instanceLabel')}{' '}
        <span className="text-(--color-muted)" data-testid="sidebar-instance">{handle}</span>
      </div>
      <div>
        {t('uptimeLabel')}{' '}
        <span className="text-(--color-muted)" data-testid="sidebar-uptime">{deployView(info).uptime}</span>
      </div>
      <NarrowFooterExtras />
    </div>
  );
}

// NarrowFooterExtras —— 窄屏顶栏放不下的那几样（版本、登录的是谁、去公开页）落在这里。
// 这一节本来讲的就是「这台实例是什么」，版本和身份是同一件事的两句；`lg` 起它们回到顶栏，
// 这里就收起来，不在桌面上重复说一遍。
function NarrowFooterExtras() {
  const t = useTranslations('adminShell.topBar');
  const buildTag = useAppVersion();
  const session = useAdminSession();
  const email = session.kind === 'ready' ? session.session.email : '';
  return (
    <div className="lg:hidden mt-2 pt-2 border-t border-(--color-rule) flex flex-col gap-1">
      <div>
        {t('versionLabel')}{' '}
        <span className="text-(--color-muted)" data-testid="sidebar-build-tag">{buildTag}</span>
      </div>
      <div className="truncate text-(--color-muted)">{email}</div>
      <Link href="/" className="uppercase tracking-[0.14em] hover:text-(--color-accent) transition-colors">
        {t('viewPublic')}
      </Link>
    </div>
  );
}
