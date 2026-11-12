// /cue —— the full-screen phone view of the desktop cue app's live cards. Capture and cueing stay
// on the computer (the desktop app pushes over MCP); this page polls the same owner feed and renders
// it big, with no admin chrome, screen kept awake. Add it to the home screen (manifest.ts) and it
// opens standalone, like an app. Owner-only: the feed is read with the admin session cookie, so an
// un-signed-in phone sees the error and a sign-in link.

'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { CueFeed } from '@/components/CueFeed';
import { useCueHeartbeat } from '@/lib/admin/use-cue-heartbeat';
import { useKeepAwake } from '@/lib/admin/use-keep-awake';
import { useScreenAssistant, type AssistantEvent } from '@/lib/admin/use-screen-assistant';

function Header() {
  const t = useTranslations('adminNav');
  return (
    <header className="flex items-center gap-2 mb-5">
      <span className="inline-block w-2 h-2 rounded-full bg-(--color-accent) animate-pulse" aria-hidden />
      <span data-testid="cue-header" className="mono text-[11px] tracking-wider text-(--color-muted) uppercase">
        {t('section.screen-assistant')}
      </span>
    </header>
  );
}

// Waiting —— no cards yet: the desktop session has not started, or this device is not signed in (the
// feed read's error shows below, with a sign-in link).
function Waiting({ error }: { error: string | null }) {
  const t = useTranslations('adminJobs');
  const tAuth = useTranslations('auth');
  return (
    <div className="sm-empty">
      <div className="sm-smallcaps mb-1.5">{t('screenAssistant.emptyKicker')}</div>
      <p className="sm-empty-hint reading">{t('screenAssistant.emptyHint')}</p>
      {error && (
        <p className="mono text-[11px] text-(--color-muted) mt-3">
          {error} · <Link href="/login" className="underline">{tAuth('confirmEmail.signInLink')}</Link>
        </p>
      )}
    </div>
  );
}

function Body({ events, error }: { events: readonly AssistantEvent[]; error: string | null }) {
  return events.length > 0 ? <CueFeed events={events} /> : <Waiting error={error} />;
}

export default function CuePage() {
  const { events, error } = useScreenAssistant();
  useKeepAwake();
  useCueHeartbeat(); // tell the desktop app to hand its display here while this page is on screen
  return (
    <main className="min-h-dvh bg-(--color-paper) text-(--color-ink) px-4 py-4">
      <Header />
      <Body events={events} error={error} />
    </main>
  );
}
