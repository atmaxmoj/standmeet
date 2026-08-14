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
};

// 版本号来自 useAppVersion —— 跑着的那个进程报的。上一版这里是个 `buildTag?: string`
// 参数配一个常量默认值,而没有任何调用点传过它:那个参数唯一的作用就是让常量看起来像
// "外面给的"(F-C-10)。参数去掉了。
export function TopBar({ handle, email }: Props) {
  const buildTag = useAppVersion();
  const onSignOut = useCallback(() => void signOut(), []);
  return (
    <header className="flex items-center px-6 lg:px-8 h-14 border-b border-(--color-rule) shrink-0 gap-4">
      <TopBarBrand handle={handle} />
      <CorpusConstellation />
      <TopBarMeta email={email} buildTag={buildTag} onSignOut={onSignOut} />
    </header>
  );
}

function TopBarBrand({ handle }: { handle: string }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <div className="flex items-baseline gap-3 mono text-[11px] tracking-[0.14em] uppercase shrink-0">
      <span className="text-(--color-ink)">{t('brand')}</span>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-muted)">{t('admin')}</span>
      <span className="text-(--color-faint)">·</span>
      <span className="text-(--color-muted)">{handle}</span>
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
    <div className="flex items-baseline gap-4 shrink-0">
      <Pill tone="muted" testId="build-tag">{buildTag}</Pill>
      <Link
        href="/"
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-faint) hover:text-(--color-accent) transition-colors"
      >
        {t('viewPublic')}
      </Link>
      <span className="mono text-[10.5px] text-(--color-muted) hidden md:inline">{email}</span>
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
