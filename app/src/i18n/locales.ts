// locales.ts — the client-safe locale constants (no next/headers), shared by the server request
// config (i18n/request.ts), the middleware, and the client-side locale switcher. Kept separate so
// a client component can import LOCALES / labels without pulling next/headers into the bundle.

// LOCALES — the supported UI languages. en is the base; every other locale must mirror its message
// keys (enforced recursively by infra/scripts/check-i18n-keys). Adding one is: append here, add its
// messages/<locale>/ catalog, and add it to the middleware matcher.
export const LOCALES = ['en', 'zh', 'fr', 'hi', 'de', 'ja', 'ko', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

// LOCALE_COOKIE — where a chosen UI language persists across navigation (next-intl's convention).
export const LOCALE_COOKIE = 'NEXT_LOCALE';
// LOCALE_HEADER — the middleware sets this from a `/<locale>/…` URL prefix so the first render of
// that request already uses the right language (the cookie only takes effect next request).
export const LOCALE_HEADER = 'x-locale';

// LOCALE_LABELS — how each language names ITSELF (endonym), for the switcher: a reader recognizes
// their own language by its own name, not an English one.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English', zh: '中文', fr: 'Français', hi: 'हिन्दी',
  de: 'Deutsch', ja: '日本語', ko: '한국어', es: 'Español',
};

// isLocale — narrow an arbitrary string to a supported Locale.
export function isLocale(v: string | undefined): v is Locale {
  return v !== undefined && LOCALES.some((l) => l === v);
}
