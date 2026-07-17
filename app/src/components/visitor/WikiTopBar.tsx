// WikiTopBar —— reader 顶栏,对齐设计 wiki.js TopBar。永远在(无 session 也在),
// 只有 chat dock 才需要 code。左:standmeet / handle · wiki(wiki 用 accent 标当前
// 区)+ 有 session 时 ● unlocked·CODE / byoai·public scope。右:writing · chat ·
// 主题切换(dark/light)。border-bottom + 全宽。
//
// 组件层禁 if:全三元 + 抽小组件;主题 state 走 use-theme(SSR 安全)。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTheme } from '@/lib/page/use-theme';
import { useVisitorSessionStore, type VisitorSession } from '@/lib/visitor/session-store';

const NAV_CLS =
  'mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) '
  + 'hover:text-(--color-ink) transition-colors no-underline';

export function WikiTopBar({ handle, reading }: { handle: string; reading?: string }) {
  const { dark, toggle } = useTheme();
  const t = useTranslations('visitor.wikiTopBar');
  return (
    <header
      className="flex items-center justify-between pt-[18px] pb-[14px] px-6 lg:px-8 border-b border-(--color-rule)"
      data-testid="wiki-topbar"
    >
      <Brand handle={handle} reading={reading} />
      <nav className="flex items-baseline gap-6">
        <Link href="/writings" className={NAV_CLS}>{t('writing')}</Link>
        <Link href="/" className={NAV_CLS}>{t('chat')}</Link>
        <button
          type="button"
          onClick={toggle}
          aria-label="toggle theme"
          className={`${NAV_CLS} bg-transparent border-0 cursor-pointer`}
          data-testid="wiki-theme-toggle"
        >
          {dark ? 'light' : 'dark'}
        </button>
      </nav>
    </header>
  );
}

function Brand({ handle, reading }: { handle: string; reading?: string }) {
  const t = useTranslations('visitor.wikiTopBar');
  return (
    <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
      <Link href="/" className="text-(--color-ink) no-underline">{t('brand')}</Link>
      <span className="text-(--color-faint)">/</span>
      <Link href="/" className="text-(--color-muted) no-underline">{handle}</Link>
      <span className="text-(--color-faint)">·</span>
      <Link href="/wiki" className="text-(--color-accent) no-underline">{t('wiki')}</Link>
      <ReadingTag reading={reading} />
      <UnlockedTag />
    </div>
  );
}

// ReadingTag —— 阅读态:顶栏标出当前正在读的条目(reader 才传,index/列表不传)。
function ReadingTag({ reading }: { reading?: string }) {
  return reading ? (
    <span className="inline-flex items-baseline gap-3 normal-case" data-testid="wiki-topbar-reading">
      <span className="text-(--color-faint)">·</span>
      <span className="text-(--color-muted) text-[10.5px] tracking-[0.06em] max-w-[24ch] truncate">
        {reading}
      </span>
    </span>
  ) : null;
}

const isUnlocked = (s: VisitorSession): boolean => s.code !== null || s.byoai;

function UnlockedTag() {
  const session = useVisitorSessionStore((s) => s.session);
  return session && isUnlocked(session)
    ? <UnlockedTagBody session={session} />
    : null;
}

function UnlockedTagBody({ session }: { session: VisitorSession }) {
  const text = session.byoai ? 'byoai · public scope' : `unlocked · ${session.code ?? ''}`;
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 normal-case">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
      <span className="text-(--color-faint) text-[10px] tracking-[0.16em]">{text}</span>
    </span>
  );
}
