// TopBar —— admin 顶栏。左：standmeet · {handle} · admin · live dot。
// 中：CorpusConstellation（语料链接图:节点大小 = 链接度）。右：build info + email + sign-out。

'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { CorpusConstellation } from '@/components/admin/chrome/CorpusConstellation';
import { Pill } from '@/components/admin/atoms/Pill';
import { signOut } from '@/lib/admin/sign-out';

type Props = {
  handle: string;
  email: string;
  buildTag?: string;
};

const DEFAULT_BUILD = 'v0.1 · dev';

export function TopBar({ handle, email, buildTag = DEFAULT_BUILD }: Props) {
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

function LiveDot() {
  const t = useTranslations('adminShell.topBar');
  return (
    <span className="inline-flex items-center gap-1.5 ml-2">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
      <span className="text-(--color-faint) text-[9.5px] tracking-[0.18em]">{t('live')}</span>
    </span>
  );
}

function TopBarMeta({
  email, buildTag, onSignOut,
}: { email: string; buildTag: string; onSignOut: () => void }) {
  const t = useTranslations('adminShell.topBar');
  return (
    <div className="flex items-baseline gap-4 shrink-0">
      <Pill tone="muted">{buildTag}</Pill>
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
