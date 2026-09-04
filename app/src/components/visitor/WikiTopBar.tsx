// WikiTopBar —— the reader's top bar, matching design wiki.js TopBar.
// Always present (present even with no session) — only the chat dock
// requires a code. Left: standmeet / handle · wiki (wiki marked with the
// accent color as the current section) + when there's a session,
// ● unlocked·CODE / byoai·public scope. Right: writing · chat · theme
// toggle (dark/light). border-bottom + full width.
//
// Components ban if: all ternaries + extracted small components; theme
// state goes through use-theme (SSR-safe).

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTheme } from '@/lib/page/use-theme';
import { useReadingTitle } from '@/lib/visitor/use-reading-title';

const NAV_CLS =
  'mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) '
  + 'hover:text-(--color-ink) transition-colors no-underline';

// flex-wrap: on a narrow screen the brand group and the nav group don't
// fit on one line. The previous version had neither wrap nor shrink, so
// they **overlapped each other** — the breadcrumb's `WIKI` and the nav's
// `WRITINGS` rendered as a garbled `WIKIWRITING`, and the theme toggle on
// the right edge got clipped off-screen. Wrapping instead of cutting any
// item: the nav drops to a second line, and every entry point stays.
export function WikiTopBar({ handle }: { handle: string }) {
  const { dark, toggle } = useTheme();
  const t = useTranslations('visitor.wikiTopBar');
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-[18px] pb-[14px] px-4 sm:px-6 lg:px-8 border-b border-(--color-rule)"
      data-testid="wiki-topbar"
    >
      <Brand handle={handle} />
      <nav className="flex items-baseline gap-5 sm:gap-6">
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

function Brand({ handle }: { handle: string }) {
  const t = useTranslations('visitor.wikiTopBar');
  const reading = useReadingTitle();
  return (
    <div className="mono text-[11px] tracking-[0.14em] uppercase flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
      <Link href="/" className="text-(--color-ink) no-underline">{t('brand')}</Link>
      <span className="text-(--color-faint)">/</span>
      <Link href="/" className="text-(--color-muted) no-underline">{handle}</Link>
      <span className="text-(--color-faint)">·</span>
      <Link href="/wiki" className="text-(--color-accent) no-underline">{t('wiki')}</Link>
      <ReadingTag reading={reading} />
    </div>
  );
}

// ReadingTag —— the reading state: the top bar marks the entry currently
// being read (passed only by the reader, not by the index/list).
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

// This top bar **no longer talks about the current session** (UX-80). It
// used to carry a `● unlocked · VOICE-01`, while the session strip right
// below it also read `● VOICE · CODE · VOICE-01 · you · <name> … EXIT
// SESSION` — the same fact, two full-width bars, two live dots, stacked in
// front of the content.
//
// The two appear under **exactly the same condition**
// (`session.code !== null || session.byoai`, the very condition the strip
// itself renders on), so dropping this label loses no information: session
// matters belong to the session strip, and this top bar answers only
// "whose site is this, which section am I in, where can I go". The chat
// screen already collapsed this once in UX-53 (folding site identity into
// the strip's own slots); the reader page keeps both bars — it needs
// navigation even with no session — so what's being collapsed here is the
// **duplication**, not the top bar itself.
