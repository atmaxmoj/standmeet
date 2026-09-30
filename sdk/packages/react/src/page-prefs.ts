// page-prefs.ts —— the visitor's language and theme for a microsite page, hydration-safe.
//
// A microsite is prerendered at build time, so the first client render must produce the same HTML
// as the prerender. Reading localStorage / navigator / matchMedia in that first render makes a
// Chinese or dark-mode visitor's first render differ: React reports #418 for text, and for an
// attribute (data-theme) it keeps the server's value — a dark-mode visitor stays on the light theme.
// These hooks render the prerender's default first and apply the stored choice right after mount.

import { useEffect, useRef, useState } from 'react';

const LANG_KEY = 'sm-lang';        // this toggle's memory; the widgets read <html lang>, not this
const THEME_KEY = 'standmeet-dark'; // '1' dark, '0' light, absent = follow the system

/** The page language among `supported`: `fallback` on the first render, then the visitor's stored
 *  choice, else their browser language, else `fallback`. Setting it stores the choice. The page
 *  declares whichever it shows (<html lang>): that is what screen readers and the SDK's own widgets
 *  follow — the stored choice is only this toggle's memory. */
export function usePageLang<L extends string>(
  supported: readonly L[], fallback: L,
): [L, (lang: L) => void] {
  const [lang, setLang] = useState<L>(fallback);
  // Read once, on mount: a page passes `supported` as a literal, so depending on it would re-run
  // every render and undo the visitor's own switch.
  const initial = useRef({ supported, fallback });
  useEffect(() => {
    setLang(visitorLang(initial.current.supported, initial.current.fallback));
  }, []);
  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* no document */ }
  }, [lang]);
  const choose = (next: L) => {
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* no storage */ }
  };
  return [lang, choose];
}

function visitorLang<L extends string>(supported: readonly L[], fallback: L): L {
  const known = (v: string): v is L => (supported as readonly string[]).includes(v);
  try {
    const stored = localStorage.getItem(LANG_KEY) ?? '';
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
