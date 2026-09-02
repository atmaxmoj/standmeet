// use-corpus-href —— carry the reader's current language along when following a link.
//
// `?lang=zh` switches **this one** note's side, but the reader doesn't read
// just one: pick a language, then click another node in the tree, and that
// link is bare `/wiki/<path>` — the language is gone on the spot, and the
// click lands back in English. **A choice you can only make once is the same
// as not having the choice** (owner's own words: "then what's the point of it").
//
// Why fix it here: a corpus item's address has exactly one home (`corpusHref`,
// see the account at the top of href.ts). Language is part of the address, so
// it belongs in that same home — otherwise it's 34 call sites each having to
// remember to append `?lang=`, which is the same shotgun firing again.
//
// Why still go through the URL instead of storing it: the address carries the
// language, so a shared link shows the same side to whoever opens it, a
// crawler indexes that same side, and the back button returns to the previous
// language. These are the three reasons LanguageSwitch chose the URL in the
// first place, and none of them changed. What's added here is just "carry it
// forward when navigating too".

'use client';

import { useSearchParams } from 'next/navigation';

import { citationHref, corpusHref, type CorpusGenre, type CorpusRef } from '@/lib/corpus/href';

// useCorpusHref —— returns an address-building function that appends the
// reader's current language.
//
// When no language is chosen (no `?lang=` on the URL) it's byte-identical to
// `corpusHref` — it never invents a `?lang=` out of nowhere, because "nothing
// chosen" and "the default was chosen" aren't the same thing: the latter
// would override a note's own identity language.
export function useCorpusHref(): (ref: CorpusRef) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (ref: CorpusRef) => withLang(corpusHref(ref), lang);
}

// useCitationHref —— the citation shown under an answer, also carrying
// language. Choosing path vs. slug still belongs to citationHref (that's a
// genre concern); this only appends the language.
export function useCitationHref():
(c: { genre: CorpusGenre; path: string; slug: string }) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (c) => withLang(citationHref(c), lang);
}

// useReaderLangHref —— append language to an address that's **already computed**.
//
// Links inside the body don't go through corpusHref: the vault's `[[X]]` gets
// rewritten by the backend into `/wiki/<path>` before being handed to the
// markdown renderer. And that's exactly the kind of link readers click most
// as they read — breadcrumbs carried the language, body links didn't, so the
// choice was still lost on the very first click (this is what production
// telemetry showed: three breadcrumb links carrying ?lang=zh, three body links bare).
//
// Only recognizes this site's own corpus paths: external links and other
// routes pass through unchanged — tacking our query param onto a third-party
// address is both useless and rude.
export function useReaderLangHref(): (href: string) => string {
  const lang = useSearchParams()?.get('lang') ?? '';
  return (href: string) => (isCorpusPath(href) ? withLang(href, lang) : href);
}

const CORPUS_PATH = /^\/(wiki|output|writings)\//;

// isCorpusPath —— a corpus address on this site, and **not already carrying a
// query string**. One that already has one has already stated what it wants,
// so it isn't overridden (e.g. the switcher's own `?lang=en` links).
function isCorpusPath(href: string): boolean {
  return CORPUS_PATH.test(href) && !href.includes('?');
}

// withLang —— an empty address passes through unchanged (caller uses this to skip rendering the link, see corpusHref).
function withLang(href: string, lang: string): string {
  return href === '' || lang === '' ? href : `${href}?lang=${encodeURIComponent(lang)}`;
}
