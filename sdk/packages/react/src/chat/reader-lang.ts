// reader-lang —— carry the reader's chosen language (`?lang=`) along a corpus link.
//
// A reader who picked `?lang=zh` and clicks a citation or a link in an answer must land on the same
// side. The language is part of the address, so it is appended where the address is made. The
// app's own reader components do the same through next/navigation (app/src/lib/corpus/
// use-corpus-href.ts) with the pure helpers below; the chat views run outside Next too (a
// microsite, the embed), so here the language comes from a host that knows it (ReaderLangProvider)
// or, without one, from the page's own URL.

import { createContext, useContext, useSyncExternalStore } from 'react';

import { citationHref, type CorpusGenre } from './href.js';

const ReaderLangContext = createContext<string | null>(null);

// ReaderLangProvider —— a host that tracks the language itself (the app, from its router) passes it
// down; the chat views then never read the URL.
export const ReaderLangProvider = ReaderLangContext.Provider;

function langFromLocation(): string {
  return new URLSearchParams(window.location.search).get('lang') ?? '';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => { window.removeEventListener('popstate', onChange); };
}

export function useReaderLang(): string {
  const given = useContext(ReaderLangContext);
  const fromURL = useSyncExternalStore(subscribe, langFromLocation, () => '');
  return given ?? fromURL;
}

const CORPUS_PATH = /^\/(wiki|output|writings)\//;

// isCorpusPath —— a corpus address on this site, and **not already carrying a
// query string**. One that already has one has already stated what it wants,
// so it isn't overridden (e.g. the switcher's own `?lang=en` links).
export function isCorpusPath(href: string): boolean {
  return CORPUS_PATH.test(href) && !href.includes('?');
}

// withLang —— an empty address passes through unchanged (caller uses this to skip rendering the link, see corpusHref).
export function withLang(href: string, lang: string): string {
  return href === '' || lang === '' ? href : `${href}?lang=${encodeURIComponent(lang)}`;
}

// useCitationHref —— the citation shown under an answer, carrying the reader's language.
export function useCitationHref(): (c: { genre: CorpusGenre; path: string; slug: string }) => string {
  const lang = useReaderLang();
  return (c) => withLang(citationHref(c), lang);
}

// useReaderLangHref —— append the language to an address that is already computed (a link inside
// an answer's body). Only this site's corpus paths; external links pass through unchanged.
export function useReaderLangHref(): (href: string) => string {
  const lang = useReaderLang();
  return (href: string) => (isCorpusPath(href) ? withLang(href, lang) : href);
}
