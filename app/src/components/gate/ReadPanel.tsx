// ReadPanel — the gate's "no code, no BYOAI, just read" path.
//
// Why it exists: the gate used to give a codeless visitor only two doors — enter a
// code, or BYOAI (which means the visitor produces their own API key). Meanwhile
// the wiki and writings that are **already public** on this instance had zero
// links on this page; the page's own copy even says "bring your own AI to chat
// with the public corpus" — admitting a public corpus exists while never saying
// where it is. The top nav has no links on this page either (the `/wiki` top nav
// has WRITING / CHAT, the gate's doesn't), so a visitor has no way out from here.
// So the lowest-effort action — "read what they've written" — ended up costing
// more than "go get an OpenAI key".
//
// **Only open the door when there's something behind it**: don't render a link
// whose count (`/wiki` or `/writings`) is 0. An empty entry is worse than no
// entry — clicking through lands on a blank page, and the visitor can't tell
// whether they took a wrong turn or the product is broken. When both are 0 the
// whole block disappears and the gate falls back to its original two doors.

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { CustomPageLink } from '@/lib/api/custom-pages';

type Props = { publicWiki: number; publicWritings: number; pages?: readonly CustomPageLink[] };

const LINK_CLS = 'mono text-[12px] tracking-[0.14em] uppercase text-(--color-accent) '
  + 'hover:text-(--color-ink) transition-colors no-underline';

export function ReadPanel({ publicWiki, publicWritings, pages }: Props) {
  return hasSomethingToRead(publicWiki, publicWritings, pages)
    ? <ReadPanelBody publicWiki={publicWiki} publicWritings={publicWritings} pages={pages} />
    : null;
}

// hasSomethingToRead —— open the door only when a codeless visitor can reach something:
// a public wiki/writings tree, or at least one published custom page.
function hasSomethingToRead(
  publicWiki: number, publicWritings: number, pages?: readonly CustomPageLink[],
): boolean {
  return publicWiki + publicWritings > 0 || (pages !== undefined && pages.length > 0);
}

// `mb-14` is required: BYOAIPanel carries no margin of its own (it used to sit
// right after `<Sep />`). Without it, `WRITINGS · 1 →` would butt up against the
// next block's kicker `NO CODE? · BYOAI`, the two blocks would read as one, and
// that link would look like part of BYOAI.
function ReadPanelBody({ publicWiki, publicWritings, pages }: Props) {
  const t = useTranslations('gate.read');
  return (
    <section className="mt-14 mb-14" data-testid="gate-read-panel">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-2">
        {t('kicker')}
      </div>
      <h2 className="font-serif text-(--color-ink) text-[clamp(26px,4vw,34px)] font-[380] tracking-[-0.02em] leading-[1.1] mb-3">
        {t('heading')}
      </h2>
      <p className="text-(--color-muted) max-w-[62ch] mb-5">{t('body')}</p>
      {/* The two links carry no testid: `Link` is a component, and a testid can
          only land on a bare DOM element. Locate them by accessible name instead
          (`getByRole('link', { name: /wiki/ })`) — which is also how a real
          person finds them. */}
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <ReadLink href="/wiki" label={t('wiki')} count={publicWiki} />
        <ReadLink href="/writings" label={t('writings')} count={publicWritings} />
      </div>
      <GatePages pages={pages} />
    </section>
  );
}

// GatePages —— the owner's published custom pages, linked by title so a codeless visitor
// can reach the curated pages too, not only the raw wiki / writings trees. Empty → nothing.
function GatePages({ pages }: { pages?: readonly CustomPageLink[] }) {
  return pages && pages.length > 0 ? (
    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4" data-testid="gate-custom-pages">
      {pages.map((p) => (
        <Link
          key={p.slug}
          href={`/p/${p.slug}`}
          className="font-serif text-(--color-ink) text-[15px] hover:text-(--color-accent) transition-colors"
        >
          {p.title}
        </Link>
      ))}
    </div>
  ) : null;
}

// The count printed on the link isn't decoration: it's the visitor's only way to
// judge "is there anything behind this door", since nothing else on this page says
// how much this instance has made public. The one whose count is 0 doesn't render
// at all.
function ReadLink({ href, label, count }: { href: string; label: string; count: number }) {
  return count > 0
    ? (
      <Link href={href} className={LINK_CLS}>
        {label} <span className="text-(--color-faint)">· {count} →</span>
      </Link>
    )
    : null;
}
