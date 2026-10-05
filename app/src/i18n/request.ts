// i18n/request — the server-side entry point for next-intl: which locale this request uses, which
// set of messages it loads.
//
// Multi-language (G): the locale is resolved from the `x-locale` request header (set by the
// middleware from a `/<locale>/…` URL prefix, so a language is shareable in the URL and correct on
// the very first render) with the `NEXT_LOCALE` cookie as the persisted fallback, then the base
// locale `en`. The catalog is loaded DYNAMICALLY per locale — only the active language's 12
// namespace files are pulled per request, and adding a language needs no change here (just its
// messages/<locale>/ folder + a line in i18n/locales.ts; the recursive parity check enforces it
// mirrors en).
//
// **Namespace = file**, flat, one per section: the FILE stem maps to the useTranslations namespace.

import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import {
  DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_HEADER, isLocale, type Locale,
} from '@/i18n/locales';

// NAMESPACES — message file stem → the useTranslations namespace key it provides.
const NAMESPACES: Record<string, string> = {
  'admin-shell': 'adminShell', 'admin-nav': 'adminNav', 'admin-corpus': 'adminCorpus',
  'admin-access': 'adminAccess', 'admin-integrations': 'adminIntegrations', 'admin-jobs': 'adminJobs',
  'admin-pages': 'adminPages',
  auth: 'auth', gate: 'gate', page: 'page', reader: 'reader', visitor: 'visitor', writings: 'writings',
};

// loadNamespace — one namespace file's message tree. A dynamic JSON import is inherently `any`;
// next-intl treats messages as an opaque tree, and the real shape guard is the recursive key-parity
// check (infra/scripts/check-i18n-keys) — so the two unsafe-any rules are disabled just here.
async function loadNamespace(locale: Locale, file: string): Promise<unknown> {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  const mod = await import(`./messages/${locale}/${file}.json`);
  const tree: unknown = mod.default;
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  return tree;
}

// loadCatalog — one locale's messages, assembled from its 13 namespace files.
async function loadCatalog(locale: Locale): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(NAMESPACES).map(async ([file, key]) => {
      const tree = await loadNamespace(locale, file);
      return [key, tree] as const;
    }),
  );
  return Object.fromEntries(entries);
}

// resolveLocale — header (this request's URL prefix) wins; cookie (the visitor's choice) next; then
// the browser's languages, the same signal a bilingual microsite reads on a first visit (so a
// Chinese browser no longer gets a Chinese home page and an English /wiki — owner 2026-10-04:
// "有时候我看见中文，有时候我看见英文"); else base.
function resolveLocale(
  headerLocale: string | undefined, cookieLocale: string | undefined, acceptLanguage: string,
): Locale {
  if (isLocale(headerLocale)) return headerLocale;
  if (isLocale(cookieLocale)) return cookieLocale;
  return browserLocale(acceptLanguage) ?? DEFAULT_LOCALE;
}

// browserLocale — the first supported language in an Accept-Language header ("zh-CN,zh;q=0.9,en"),
// in the order the browser sent them: the whole tag when supported (zh-HK), traditional Chinese
// (zh-TW, zh-Hant) as zh-HK, else the base language (zh-CN → zh).
export function browserLocale(acceptLanguage: string): Locale | null {
  for (const part of acceptLanguage.split(',')) {
    const tag = (part.split(';')[0] ?? '').trim();
    if (tag === '') continue;
    const whole = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (whole !== undefined) return whole;
    if (/^zh-(tw|hant|mo)/i.test(tag)) return 'zh-HK';
    const base = tag.split('-')[0]?.toLowerCase();
    if (isLocale(base)) return base;
  }
  return null;
}

export default getRequestConfig(async () => {
  const h = await headers();
  const headerLocale = h.get(LOCALE_HEADER) ?? undefined;
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = resolveLocale(headerLocale, cookieLocale, h.get('accept-language') ?? '');
  return { locale, messages: await loadCatalog(locale) };
});
