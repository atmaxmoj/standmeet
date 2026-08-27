// TopBar —— admin 顶栏。左：standmeet · {handle} · admin · live dot。
// 中：CorpusConstellation（语料链接图:节点大小 = 链接度）。右：build info + email + sign-out。

'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { CorpusConstellation } from '@/components/admin/chrome/CorpusConstellation';
import { Pill } from '@/components/admin/atoms/Pill';
import { useAppVersion } from '@/lib/app-version';
import { signOut } from '@/lib/admin/sign-out';
import { useInstanceLiveness } from '@/lib/state/instance-liveness';

type Props = {
  handle: string;
  email: string;
  // 侧栏抽屉的开关。只在 `lg` 以下露出来 —— 桌面上侧栏恒在，不需要一个开关。
  navOpen: boolean;
  onToggleNav: () => void;
};

// 版本号来自 useAppVersion —— 跑着的那个进程报的。上一版这里是个 `buildTag?: string`
// 参数配一个常量默认值,而没有任何调用点传过它:那个参数唯一的作用就是让常量看起来像
// "外面给的"(F-C-10)。参数去掉了。
export function TopBar({ handle, email, navOpen, onToggleNav }: Props) {
  const buildTag = useAppVersion();
  const onSignOut = useCallback(() => void signOut(), []);
  return (
    <header className="flex items-center px-4 sm:px-6 lg:px-8 h-14 border-b border-(--color-rule) shrink-0 gap-3 sm:gap-4">
      <NavToggle open={navOpen} onToggle={onToggleNav} />
      <TopBarBrand handle={handle} />
      {/* 星座图是**装饰性的**信息层。窄屏上它跟品牌和右侧那组抢同一条 56px 的横条，
          三样都被挤扁；它是这里唯一一件拿掉之后什么都不少的东西，所以拿掉的是它。 */}
      <div className="hidden lg:contents"><CorpusConstellation /></div>
      <TopBarMeta email={email} buildTag={buildTag} onSignOut={onSignOut} />
    </header>
  );
}

// NavToggle —— 抽屉的开关。文字不是图标：这一整套 chrome 说的都是等宽小写字
// （`view public ↗` / `sign out`），换成汉堡图标是往里塞一套别的语汇。
function NavToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="admin-nav-toggle"
      aria-expanded={open}
      aria-controls="admin-sidebar"
      className="lg:hidden shrink-0 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors"
    >
      {open ? t('navClose') : t('navOpen')}
    </button>
  );
}

// 窄屏上这条横条只有 358px，而它要装 `sections` + 品牌全称 + 版本 + `view public`
// + `sign out`。上一版每一组都是 `shrink-0`，于是右边那一组被整个挤出屏幕：版本徽标只
// 剩半个圆，`sign out` 一个字都不在（那是 owner 唯一的退出入口）。
//
// 让位的是**说明性的那几段**（`/ admin · <handle>` —— 人已经在 admin 里，标题栏也写着
// 是谁），留下的是品牌、这台机器活没活、和退出。挪走的不是没了：版本、邮箱、view public
// 在抽屉页脚里，那儿本来就在讲"这台实例是什么"。
function TopBarBrand({ handle }: { handle: string }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <div className="flex items-baseline gap-3 mono text-[11px] tracking-[0.14em] uppercase min-w-0">
      <span className="text-(--color-ink)">{t('brand')}</span>
      <span className="text-(--color-faint) hidden lg:inline">/</span>
      <span className="text-(--color-muted) hidden lg:inline">{t('admin')}</span>
      <span className="text-(--color-faint) hidden lg:inline">·</span>
      <span className="text-(--color-muted) hidden lg:inline truncate">{handle}</span>
      <LiveDot />
    </div>
  );
}

// LiveDot —— 它说的那个字必须**是**这台实例此刻的状态（F-N-6）。
// 以前它是个常量：后端停机时正文写着这一节加载失败，顶栏照样 `● LIVE`。
// 现在它读 instance-liveness —— 数据来自已经发生的那些请求，不额外轮询。
function LiveDot() {
  const t = useTranslations('adminShell.topBar');
  const liveness = useInstanceLiveness();
  const live = liveness === 'live';
  return (
    <span className="inline-flex items-center gap-1.5 ml-2">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${live
        ? 'bg-(--color-accent) live-dot'
        : 'bg-(--color-faint)'}`}
      />
      <span
        data-testid="shell-liveness"
        className="text-(--color-faint) text-[9.5px] tracking-[0.18em]"
      >
        {live ? t('live') : t('notAnswering')}
      </span>
    </span>
  );
}

function TopBarMeta({
  email, buildTag, onSignOut,
}: { email: string; buildTag: string; onSignOut: () => void }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <div className="flex items-baseline gap-4 shrink-0 ml-auto">
      {/* 版本 / view public / 邮箱在窄屏上让位给 `sign out`，三样都在抽屉页脚里。 */}
      <span className="hidden lg:inline"><Pill tone="muted" testId="build-tag">{buildTag}</Pill></span>
      <Link
        href="/"
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent) transition-colors hidden lg:inline"
      >
        {t('viewPublic')}
      </Link>
      <span className="mono text-[10.5px] text-(--color-muted) hidden xl:inline">{email}</span>
      <button
        type="button"
        onClick={onSignOut}
        data-testid="signout"
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent) transition-colors"
      >
        {t('signOut')}
      </button>
    </div>
  );
}
