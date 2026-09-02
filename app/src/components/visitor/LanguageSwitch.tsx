// LanguageSwitch —— the language switcher for a multilingual note.
//
// **Not** the same as Obsidian's row of radio buttons: that row is a
// presentation artifact living in the vault (propped up by CSS's
// nth-of-type, so it inherently only supports three languages), and it's
// dropped on sync. This is our own, and it supports N languages.
//
// Switching = changing the URL (`?lang=zh`), not local state:
//   · a shared link carries the language, so whoever opens it sees the
//     same version;
//   · a crawler or agent fetching that URL gets that same version
//     (server-rendered);
//   · the back button returns to the previous language, not the previous
//     page.
//
// Goes through `next/link` rather than a bare `<a>`: **none** of the three
// points above can depend on a full page reload, and a bare `<a>` would
// reload the whole document — a reader mid-article who switches language
// would get a white flash and lose their scroll position. `Link` is
// client-side navigation: the URL still changes, a crawler still gets the
// server-rendered version (same URL), back-button behavior is unchanged,
// it just no longer reloads. `scroll={false}` is required: switching
// language isn't switching pages — the reader is still in the same spot of
// the same article and shouldn't get bounced back to the top.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { LanguageOption } from '@/lib/api/public';

export function LanguageSwitch({
  languages, current,
}: {
  languages: readonly LanguageOption[];
  current: string;
}) {
  const pathname = usePathname();
  // A note with only one language (the vast majority) → the whole
  // component doesn't render: a switcher with a single option is noise.
  return languages.length < 2 ? null : (
    <nav
      data-testid="language-switch"
      aria-label="language"
      className="flex items-baseline gap-2 mono text-[10px] tracking-[0.16em] uppercase"
    >
      {languages.map((l) => (
        <LanguageLink
          key={l.code} option={l} active={l.code === current} pathname={pathname}
        />
      ))}
    </nav>
  );
}

function LanguageLink({
  option, active, pathname,
}: {
  option: LanguageOption;
  active: boolean;
  pathname: string;
}) {
  const cls = active
    ? 'text-(--color-paper) bg-(--color-ink) px-1.5 py-0.5'
    : 'text-(--color-muted) hover:text-(--color-ink) px-1.5 py-0.5';
  return (
    // No `data-testid` here: `Link` is a component, and a testid can only
    // land on a bare DOM element (a gate enforces this). Tests locate this
    // via `hrefLang` / accessible name — which is also how readers
    // recognize them.
    <Link
      href={`${pathname}?lang=${option.code}`}
      hrefLang={option.code}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cls}
    >
      {option.label}
    </Link>
  );
}
