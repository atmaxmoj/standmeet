// LangSwitch —— a visible place for the visitor to pick the language (owner 2026-10-04: "就像admin
// 那样给出lang switch button，但是这个button是个sdk，看看owner想不想用"). A page that renders it
// is bilingual: the choice is stored for the whole instance (visitor-lang.ts), the page declares it
// (<html lang>, which the widgets and the agent's answers follow), and usePageLang re-renders the
// page's own text. A page that leaves it out keeps its author's language.
//
//   <LangSwitch />                          English ↔ 简体中文
//   <LangSwitch langs={['en', 'zh', 'ja']} />
//   <LangSwitch onChange={() => router.refresh()} />   a host that renders on the server

'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { chooseLang } from './visitor-lang.js';

export const LANG_LABELS: Record<string, string> = {
  en: 'English', zh: '简体中文', 'zh-HK': '繁體中文（香港）', fr: 'Français', hi: 'हिन्दी',
  de: 'Deutsch', ja: '日本語', ko: '한국어', es: 'Español',
};

export interface LangSwitchProps {
  /** The languages this page offers, in menu order. Default: English and Simplified Chinese. */
  langs?: readonly string[];
  /** Called after the choice is stored, e.g. to re-render a server-rendered page. */
  onChange?: (lang: string) => void;
}

export function LangSwitch({ langs = ['en', 'zh'], onChange }: LangSwitchProps): ReactElement {
  const active = useDeclaredLang(langs);
  const [open, setOpen] = useState(false);
  const pick = (lang: string) => {
    setOpen(false);
    if (lang === active) return;
    chooseLang(lang);
    onChange?.(lang);
  };
  return (
    <details
      className="sm-lang-switch"
      data-testid="lang-switch"
      open={open}
      onToggle={(e) => { setOpen(e.currentTarget.open); }}
    >
      <summary className="sm-lang-switch-current" aria-label="language">{LANG_LABELS[active] ?? active}</summary>
      <nav className="sm-lang-switch-menu">
        {langs.map((lang) => (
          <button
            key={lang}
            type="button"
            lang={lang}
            data-testid={`lang-opt-${lang}`}
            aria-current={lang === active ? 'true' : undefined}
            className="sm-lang-switch-opt"
            onClick={() => { pick(lang); }}
          >
            {LANG_LABELS[lang] ?? lang}
          </button>
        ))}
      </nav>
    </details>
  );
}

// useDeclaredLang —— the language the page declares now (<html lang>) among `langs`; the first one
// before mount (matches a prerender) and whenever the page declares something it doesn't offer.
function useDeclaredLang(langs: readonly string[]): string {
  // A page passes `langs` as a literal (a new array each render); key the effect on its content.
  const key = langs.join(',');
  const [lang, setLang] = useState(langs[0] ?? 'en');
  useEffect(() => {
    const offered = key.split(',');
    const read = () => {
      const declared = document.documentElement.lang;
      setLang(offered.includes(declared) ? declared : (offered[0] ?? 'en'));
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => { obs.disconnect(); };
  }, [key]);
  return lang;
}
