// middleware.ts — two jobs, both scoped tightly by the matcher below:
//
//  1) A Slice 4 — serve the owner's custom `home` page at the site root `/`. When a `home` page is
//     promoted live, `/` serves it (proxied to the backend, whose HTML has `<base href="/">`; its
//     `./assets/*` are proxied by the next.config `/assets/*` rewrite). When none is live — a fresh
//     instance whose owner hasn't published one, or an unclaimed instance — this falls through to
//     the built-in root page (`app/page.tsx`), which also owns the unclaimed → /setup redirect. Any
//     miss (no home page, backend slow/down, probe error) keeps today's behavior; `/` never depends
//     on this succeeding.
//
//  2) G (multi-language) — a `/<locale>/…` URL prefix (e.g. /zh/gate) makes a language shareable in
//     the URL. The middleware strips the prefix (rewriting to the unprefixed route so no route file
//     moves), sets a request header so the FIRST render already uses that language, and sets the
//     NEXT_LOCALE cookie so the choice persists across later un-prefixed navigation. Unprefixed
//     paths aren't matched here — they read the persisted cookie in i18n/request.ts.

import { NextResponse, type NextRequest } from 'next/server';

import { LOCALES, LOCALE_COOKIE, LOCALE_HEADER } from '@/i18n/locales';
import { SESSION_COOKIE } from '@/lib/visitor/session-cookie';

const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://backend:8000';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

// homepageRewrite — serve the live home page at (the stripped) root, else fall through to the
// built-in page. `headers` carries any x-locale set by a /<locale>/ strip.
async function homepageRewrite(headers: Headers): Promise<NextResponse> {
  try {
    const probe = await fetch(`${BACKEND_URL}/api/v1/homepage`, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2500),
    });
    if (probe.ok) {
      return NextResponse.rewrite(new URL('/api/v1/homepage', BACKEND_URL), { request: { headers } });
    }
  } catch {
    // no home page / backend unreachable / timeout → keep the built-in root page.
  }
  return NextResponse.next({ request: { headers } });
}

// isPrefetch — a Next.js router prefetch (or a browser speculative prefetch), which must not be
// treated as the reader choosing a language.
function isPrefetch(req: NextRequest): boolean {
  return req.headers.get('next-router-prefetch') !== null
    || (req.headers.get('sec-purpose') ?? '').includes('prefetch')
    || req.headers.get('purpose') === 'prefetch';
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const seg = pathname.split('/')[1] ?? '';
  const headers = new Headers(req.headers);
  // The codeless homepage is served only for a plain `/` view. It must NOT be served when:
  //   - the request carries a code (fresh ?code=) or an already-issued session (SESSION_COOKIE) —
  //     that visitor gets the coded-visitor strategy (page.tsx → VisitorRoot): absorb the code,
  //     name picker / built-in chat / attached microsite. The session lives in localStorage
  //     (invisible to the server); SESSION_COOKIE is the presence flag the store mirrors for this.
  //   - the request carries a question (?q=), e.g. a reader's AskAboutThis hand-off — VisitorRoot
  //     forwards a codeless question on to /gate?q=. Routing `/?q=` to the homepage would swallow it.
  const coded = req.nextUrl.searchParams.has('code') || req.cookies.has(SESSION_COOKIE)
    || req.nextUrl.searchParams.has('q');

  if (LOCALES.some((l) => l === seg)) {
    // /<locale>/rest → render `rest` in `<locale>`, keeping the browser URL at /<locale>/rest.
    headers.set(LOCALE_HEADER, seg);
    const rest = pathname.slice(seg.length + 1) || '/';
    const res = (rest === '/' && !coded)
      ? await homepageRewrite(headers)
      : NextResponse.rewrite(new URL(rest + search, req.url), { request: { headers } });
    // Persist the choice — but NOT on a prefetch. A prefetch is not a navigation the reader made,
    // so it must never change their language; it just warms the render cache for that URL.
    if (!isPrefetch(req)) {
      res.cookies.set(LOCALE_COOKIE, seg, { path: '/', sameSite: 'lax', maxAge: YEAR_SECONDS });
    }
    return res;
  }

  if (pathname === '/' && !coded) return homepageRewrite(headers);
  return NextResponse.next();
}

// Matched paths only: the root (homepage) and any `/<locale>/…` prefix. Every other path is left
// alone — it reads the persisted NEXT_LOCALE cookie in i18n/request.ts.
export const config = {
  matcher: ['/', '/(en|zh|fr|hi|de|ja|ko|es)', '/(en|zh|fr|hi|de|ja|ko|es)/:path*'],
};
