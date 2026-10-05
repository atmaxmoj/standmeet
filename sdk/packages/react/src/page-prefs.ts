// page-prefs.ts —— the visitor's language and theme for a microsite page, hydration-safe.
//
// A microsite is prerendered at build time, so the first client render must produce the same HTML
// as the prerender. Reading localStorage / navigator / matchMedia in that first render makes a
// Chinese or dark-mode visitor's first render differ: React reports #418 for text, and for an
// attribute (data-theme) it keeps the server's value — a dark-mode visitor stays on the light theme.
// These hooks render the prerender's default first and apply the stored choice right after mount.

import { useEffect, useRef, useState } from 'react';

import { chooseLang, chosenLang, VISITOR_LANG_EVENT } from './visitor-lang.js';

// LEGACY_LANG_KEY —— where a bilingual page's toggle kept the choice before it moved to the shared
// cookie (visitor-lang.ts); still read so a returning visitor keeps their language.
const LEGACY_LANG_KEY = 'sm-lang';
const THEME_KEY = 'standmeet-dark'; // '1' dark, '0' light, absent = follow the system

/** The page language among `supported`: `fallback` on the first render, then the visitor's choice
 *  (the one shared with the app's pages and every bilingual page), else their browser language,
 *  else `fallback`. Setting it stores the choice for the whole instance, and the page follows a
 *  `<LangSwitch />` anywhere on it. The page declares whichever it shows (<html lang>): that is
 *  what screen readers, the SDK's widgets and the agent's answers follow. */
export function usePageLang<L extends string>(
  supported: readonly L[], fallback: L,
): [L, (lang: L) => void] {
  const [lang, setLang] = useState<L>(fallback);
  // Read once, on mount: a page passes `supported` as a literal, so depending on it would re-run
  // every render and undo the visitor's own switch.
  const initial = useRef({ supported, fallback });
  useEffect(() => {
    const { supported: langs, fallback: base } = initial.current;
    setLang(visitorLang(langs, base));
    const follow = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if ((langs as readonly string[]).includes(next)) setLang(next as L);
    };
    window.addEventListener(VISITOR_LANG_EVENT, follow);
    return () => { window.removeEventListener(VISITOR_LANG_EVENT, follow); };
  }, []);
  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* no document */ }
  }, [lang]);
  const choose = (next: L) => {
    setLang(next);
    chooseLang(next);
  };
  return [lang, choose];
}

function visitorLang<L extends string>(supported: readonly L[], fallback: L): L {
  const known = (v: string): v is L => (supported as readonly string[]).includes(v);
  const chosen = chosenLang();
  if (known(chosen)) return chosen;
  try {
    const stored = localStorage.getItem(LEGACY_LANG_KEY) ?? '';
    if (known(stored)) return stored;
  } catch { /* no storage */ }
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = tag.toLowerCase().split('-')[0] ?? '';
      if (known(base)) return base;
    }
  } catch { /* no navigator */ }
  return fallback;
}

export type PageTheme = 'light' | 'dark';

/** The page theme: 'light' on the first render, then the visitor's stored choice, else the system
 *  preference — which it keeps following while no choice is stored. */
export function usePageTheme(): PageTheme {
  const [theme, setTheme] = useState<PageTheme>('light');
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch { /* no matchMedia */ }
    const apply = () => { setTheme(visitorTheme(mq)); };
    apply();
    mq?.addEventListener('change', apply);
    return () => { mq?.removeEventListener('change', apply); };
  }, []);
  return theme;
}

function visitorTheme(mq: MediaQueryList | undefined): PageTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === '1') return 'dark';
    if (stored === '0') return 'light';
  } catch { /* no storage */ }
  return mq?.matches === true ? 'dark' : 'light';
}
