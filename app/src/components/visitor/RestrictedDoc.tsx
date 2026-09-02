// RestrictedDoc —— the client-side fallback, on the public landing page
// (wiki/output), for a non-indexed / restricted document: a code-holding
// visitor uses their session to fetch the full text through corpus_read and
// render it (if the role's ACL grants it, they can see it — this is the
// same access the AI reads and cites from). Only when there's no session /
// no permission does it fall through to the lock screen.
//
// The SSR layer only knows about published content and can't see the
// visitor's localStorage session, so this fallback has to happen on the
// client.

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ChatMarkdown } from '@/components/page/markdown';
import { CorpusContent } from '@/components/page/CorpusContent';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import type { VisitorDoc } from '@/lib/api/public';
import { useSessionScopedDoc } from '@/lib/visitor/use-session-doc';

export function RestrictedDoc({ genre, slug }: { genre: 'wiki' | 'output'; slug: string }) {
  const { loading, doc, hasSession } = useSessionScopedDoc(slug);
  const t = useTranslations('visitor.restrictedDoc');
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        {loading
          ? <Centered>{t('opening')}</Centered>
          : <Resolved genre={genre} slug={slug} doc={doc} hasSession={hasSession} />}
      </main>
      <FloatingChatDock />
    </>
  );
}

function Resolved({ genre, slug, doc, hasSession }: {
  genre: 'wiki' | 'output'; slug: string; doc: VisitorDoc | null; hasSession: boolean;
}) {
  return doc !== null
    ? <DocContent genre={genre} slug={slug} title={doc.title} body={doc.body} />
    : <Locked genre={genre} slug={slug} hasSession={hasSession} />;
}

function DocContent({ genre, slug, title, body }: {
  genre: string; slug: string; title: string; body: string;
}) {
  return (
    <article className="mx-auto max-w-2xl px-6 py-16" data-testid={`${genre}-landing`}>
      <Home />
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
        {genre} · {slug}
      </div>
      <h1 className="font-serif text-[clamp(30px,4vw,46px)] text-(--color-ink) font-normal tracking-[-0.02em] leading-[1.08] mb-8">
        {title}
      </h1>
      <div className="reading text-base" data-testid={`${genre}-body`}>
        <CorpusContent>
          <ChatMarkdown source={body} />
        </CorpusContent>
      </div>
    </article>
  );
}

// Locked —— this document can't be read. **The testid hangs on this
// branch**: without it, "the visitor can't see this document" could only
// be asserted by "some element doesn't exist" — and an element not
// existing is equally true when the page 404s, a component gets renamed,
// or a route breaks. That's an assertion that stays green even when the
// feature is broken. What needs asserting is "the visitor really is
// blocked at the door", and that needs a positive marker.
// Locked's two sentences aren't the same sentence — which one shows
// depends on **whether the visitor is holding a code** (F-R-6).
//
// No code: go to gate and enter one — that's a step they can actually take.
// Has a code: telling them to go enter a code again would mean redoing
// something already done — and their code is written right there on the
// same screen, in the top bar. The backend returns 404 uniformly for both
// "out of scope" and "doesn't exist" (refusing to confirm existence, which
// is correct), so this sentence has to **cover both cases** rather than
// asserting just one — picking the wrong one would be a false statement
// about the world.
function Locked({ genre, slug, hasSession }: {
  genre: string; slug: string; hasSession: boolean;
}) {
  const t = useTranslations('visitor.restrictedDoc');
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center" data-testid={`${genre}-locked`}>
      <Home />
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
        {genre} · {slug}
      </div>
      <h2 className="font-serif text-[28px] text-(--color-ink) font-normal mb-4">
        {lockedTitle(t, genre, hasSession)}
      </h2>
      <p className="reading text-(--color-muted) text-[16px] max-w-[36em] mx-auto mb-8">
        {hasSession ? t('outOfScopeBody') : t('lockedBody')}
      </p>
      <GateCTA show={!hasSession} />
    </div>
  );
}

// lockedTitle —— components ban if/complexity, so the title's three-way
// branch (has-code / no-code×output / no-code×entry) is pulled out here.
function lockedTitle(
  t: (k: string, v?: Record<string, string>) => string, genre: string, hasSession: boolean,
): string {
  return hasSession
    ? t('outOfScopeTitle')
    : t('lockedTitle', { kind: genre === 'output' ? t('kindOutput') : t('kindEntry') });
}

function GateCTA({ show }: { show: boolean }) {
  const t = useTranslations('visitor.restrictedDoc');
  return show ? (
    <Link
      href="/gate"
      className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 inline-block hover:bg-(--color-accent) transition-colors"
    >
      {t('enterCode')}
    </Link>
  ) : null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center mono text-[11px] tracking-[0.16em] uppercase text-(--color-muted)">
      {children}
    </div>
  );
}

function Home() {
  const t = useTranslations('visitor.restrictedDoc');
  return (
    <header className="mb-8">
      <Link href="/" className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        {t('home')}
      </Link>
    </header>
  );
}
