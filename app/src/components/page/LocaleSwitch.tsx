// LocaleSwitch — the UI-language switcher (top-right of the visitor top bar). Distinct from
// visitor/LanguageSwitch, which picks a NOTE's content language (`?lang=`); this picks the
// language of the interface chrome.
//
// A compact disclosure (the current language as the trigger; the full list opens on click) so it
// scales past a couple of languages without overflowing the bar. Each option is a real
// `<a hrefLang>` (via next/link) to `/<locale>/<current-path>`: the middleware reads the prefix,
// renders that language on the first paint, and sets the NEXT_LOCALE cookie so the choice persists.
// The language is therefore shareable in the URL — a `/ja/gate` link opens in Japanese for whoever
// follows it.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';

import { LOCALES, LOCALE_LABELS, isLocale, type Locale } from '@/i18n/locales';

// unprefixed — drop a leading /<locale> so we can re-prefix with the target locale cleanly.
// usePathname may report either the browser path (/ja/gate) or the middleware-rewritten one
// (/gate); stripping a present prefix handles both.
function unprefixed(pathname: string): string {
  const first = pathname.split('/')[1];
  return isLocale(first) ? (pathname.slice(first.length + 1) || '/') : pathname;
}

export function LocaleSwitch() {
  const raw = useLocale();
  const active: Locale = isLocale(raw) ? raw : 'en';
  const base = unprefixed(usePathname());
  return (
    <details data-testid="locale-switch" className="relative mono text-[11px] tracking-[0.14em] uppercase">
      <summary
        className="list-none cursor-pointer text-(--color-muted) hover:text-(--color-ink) transition-colors select-none"
        aria-label="language"
      >
        {LOCALE_LABELS[active]}
      </summary>
      <nav className="absolute right-0 mt-2 sm-z-local flex flex-col gap-1 border border-(--color-rule) bg-(--color-surface) rounded-[3px] p-2 min-w-[7rem]">
        {LOCALES.map((loc) => (
          <LocaleLink
            key={loc}
            loc={loc}
            href={`/${loc}${base === '/' ? '' : base}`}
            active={loc === active}
          />
        ))}
      </nav>
    </details>
  );
}

function LocaleLink({ loc, href, active }: { loc: Locale; href: string; active: boolean }) {
  const cls = active
    ? 'text-(--color-ink)'
    : 'text-(--color-muted) hover:text-(--color-ink) transition-colors';
  return (
    // prefetch={false}: a language switch is a deliberate choice, not a likely-next page. Without
    // this, Next prefetches all N `/<locale>/…` hrefs on render, and each prefetch hits the
    // middleware, which sets the NEXT_LOCALE cookie — so merely SHOWING the switcher would silently
    // flip the reader's language (to whichever prefetch landed last). Belt-and-suspenders with the
    // middleware's own prefetch guard.
    <Link
      href={href}
      hrefLang={loc}
      prefetch={false}
      aria-current={active ? 'true' : undefined}
      className={cls}
    >
      {LOCALE_LABELS[loc]}
    </Link>
  );
}
