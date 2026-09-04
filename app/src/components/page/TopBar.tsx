// TopBar —— standmeet · <handle> · live ● left-aligned, dark/light toggle
// right-aligned. The first thing every visitor sees on the public page; the
// "live" pulse establishes the feeling that this is a live instance.

'use client';

import { useTranslations } from 'next-intl';

import { LocaleSwitch } from '@/components/page/LocaleSwitch';

type Props = {
  handle: string;
  dark: boolean;
  onToggleDark: () => void;
};

export function TopBar({ handle, dark, onToggleDark }: Props) {
  const t = useTranslations('page');
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <span className="text-(--color-ink)">{t('brand')}</span>
        <span className="text-(--color-faint)">/</span>
        <span className="text-(--color-muted)">{handle}</span>
        <span className="ml-2 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
          <span className="text-(--color-faint) text-[10px] tracking-[0.16em]">{t('topBar.live')}</span>
        </span>
      </div>
      <div className="flex items-baseline gap-4">
        <LocaleSwitch />
        <button
          type="button"
          onClick={onToggleDark}
          aria-label="toggle theme"
          className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) transition-colors"
        >
          {dark ? 'light' : 'dark'}
        </button>
      </div>
    </header>
  );
}
