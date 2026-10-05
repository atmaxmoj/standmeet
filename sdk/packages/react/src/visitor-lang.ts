// visitor-lang.ts —— the visitor's chosen language, one home for the whole instance (owner
// 2026-10-04: "有时候我看见中文，有时候我看见英文，我都不知道是我设置的还是怎么回事").
//
// The choice lives in the `NEXT_LOCALE` cookie, which the app's server already reads to render its
// own pages. A bilingual microsite reads the same cookie (usePageLang) and the language switch
// writes it, so one choice is seen everywhere. A page with no switch is not bilingual: it keeps the
// language its author wrote it in, whatever the visitor chose elsewhere (the widgets follow the
// page's <html lang>, see i18n.tsx resolveLocale).

export const VISITOR_LANG_COOKIE = 'NEXT_LOCALE';
// VISITOR_LANG_EVENT —— fired on window when the choice changes, so a switch and the page's own
// text (usePageLang) move together.
export const VISITOR_LANG_EVENT = 'standmeet:lang';
const YEAR_S = 60 * 60 * 24 * 365;

/** The language the visitor last chose, or '' when they never chose one. */
export function chosenLang(): string {
  try {
    for (const part of document.cookie.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === VISITOR_LANG_COOKIE && v !== undefined) return decodeURIComponent(v);
    }
  } catch { /* no document */ }
  return '';
}

/** Stores the visitor's choice, declares it on the page and tells every listener. */
export function chooseLang(lang: string): void {
  try {
    document.cookie = `${VISITOR_LANG_COOKIE}=${encodeURIComponent(lang)}; path=/; max-age=${YEAR_S}; samesite=lax`;
    document.documentElement.lang = lang;
    window.dispatchEvent(new CustomEvent<string>(VISITOR_LANG_EVENT, { detail: lang }));
  } catch { /* no document */ }
}
