// i18n/request — the server-side entry point for next-intl: which locale
// this request uses, which set of messages it loads.
//
// **Deliberately does not wire up locale routing** (no `app/[locale]/`).
// There is only one language right now, and a route segment is for
// "picking a language" — a feature that doesn't exist yet. Introducing the
// segment early would make every URL pay upfront for a feature that isn't
// there. next-intl officially supports this without-routing shape: locale
// is handed over from right here. When multi-language is actually needed,
// this is the file that changes (read a cookie / Accept-Language / URL
// segment) — **not a single line changes in the components**. That's the
// whole point of building the infra first.
//
// Base language = en: the product's UI is English-native; the handful of
// Chinese help copy strings that had crept in were the anomaly, and they've
// all been moved back in line.
//
// **Namespace = file**, flat, one per section (admin was already organized
// by section, so the namespaces follow that real structure instead of
// inventing a new one). The cost of flat is a long import list here; the
// payoff is that adding a section costs two lines, there's no deep-merge
// logic, and several people editing different areas at once don't collide
// on one giant JSON file.

import { getRequestConfig } from 'next-intl/server';

import adminAccess from '@/i18n/messages/en/admin-access.json';
import adminCorpus from '@/i18n/messages/en/admin-corpus.json';
import adminIntegrations from '@/i18n/messages/en/admin-integrations.json';
import adminJobs from '@/i18n/messages/en/admin-jobs.json';
import adminPages from '@/i18n/messages/en/admin-pages.json';
import adminShell from '@/i18n/messages/en/admin-shell.json';
import auth from '@/i18n/messages/en/auth.json';
import gate from '@/i18n/messages/en/gate.json';
import page from '@/i18n/messages/en/page.json';
import reader from '@/i18n/messages/en/reader.json';
import visitor from '@/i18n/messages/en/visitor.json';
import writings from '@/i18n/messages/en/writings.json';

// DEFAULT_LOCALE — the only locale. Adding a second language turns this
// into a negotiation instead of a rewrite.
export const DEFAULT_LOCALE = 'en';

// messages — each top-level key is one useTranslations(...) namespace.
export const messages = {
  adminShell,
  adminCorpus,
  adminAccess,
  adminIntegrations,
  adminJobs,
  adminPages,
  auth,
  gate,
  page,
  reader,
  visitor,
  writings,
};

export default getRequestConfig(() => ({
  locale: DEFAULT_LOCALE,
  messages,
}));
