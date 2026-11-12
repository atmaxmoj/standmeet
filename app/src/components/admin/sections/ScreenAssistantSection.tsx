// ScreenAssistantSection —— /admin/screen-assistant. The desktop cue app (modified from Cheating
// Daddy) listens on the owner's computer and streams what it heard and its cue cards here over
// MCP, so the owner can read the cards on a phone logged into admin — the desktop window can stay
// minimized. Newest first; leading letters bold (the owner reads faster that way).

'use client';

import { useTranslations } from 'next-intl';

import { CueFeed } from '@/components/CueFeed';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { useScreenAssistant } from '@/lib/admin/use-screen-assistant';

// DOWNLOAD_URL —— the desktop app's builds (the fork's GitHub releases; GPL-3.0, source alongside).
const DOWNLOAD_URL = 'https://github.com/atmaxmoj/cheating-daddy/releases/latest';
const UPSTREAM_URL = 'https://github.com/sohzm/cheating-daddy';

export function ScreenAssistantSection() {
  const t = useTranslations('adminJobs');
  const { events, error } = useScreenAssistant();
  return (
    <>
      <SectionHeader kicker={t('screenAssistant.kicker')} slug="screen-assistant" />
      <p className="reading text-[15px] mb-3 max-w-[60ch]">{t('screenAssistant.intro')}</p>
      <div className="mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <a href={DOWNLOAD_URL} data-testid="assistant-download" className="sm-btn sm-btn-sm">
          {t('screenAssistant.download')}
        </a>
        <span className="mono text-[11px] text-(--color-muted)">
          {t.rich('screenAssistant.credit', {
            upstream: (c) => <a href={UPSTREAM_URL} className="underline">{c}</a>,
          })}
        </span>
      </div>
      {error && <p className="mono text-[11px] text-(--color-accent) mb-4">{error}</p>}
      {events.length === 0 ? <Empty /> : <CueFeed events={events} />}
    </>
  );
}

function Empty() {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-empty">
      <div className="sm-smallcaps mb-1.5">{t('screenAssistant.emptyKicker')}</div>
      <p className="sm-empty-hint reading">{t('screenAssistant.emptyHint')}</p>
    </div>
  );
}
