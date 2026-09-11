// ConsentBanner —— the visitor's tracking-consent prompt (GDPR accept/decline). Shown only while
// the choice is unset; a click stores it and the banner leaves. It rides with TrackVisit, so it
// appears on exactly the visitor pages that would record something and never on admin.
//
// Rendering nothing once decided is a return of null (a ternary, not an `if`): the presentation
// layer here holds no branching logic beyond "decided yet or not".

'use client';

import { useTranslations } from 'next-intl';

import { setConsent } from '@/lib/monitor/consent';
import { useConsent } from '@/lib/monitor/use-consent';

export function ConsentBanner() {
  const t = useTranslations('visitor.consent');
  const consent = useConsent();
  return consent !== 'unset' ? null : (
    <div
      data-testid="consent-banner"
      role="dialog"
      aria-label={t('title')}
      className="fixed inset-x-0 bottom-0 sm-z-modal border-t border-(--color-rule) bg-(--color-paper) px-5 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-[64em] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="reading-tight text-[13.5px] text-(--color-ink) max-w-[48em]">
          <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) mr-2">
            {t('title')}
          </span>
          {t('body')}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            data-testid="consent-decline"
            onClick={() => setConsent('declined')}
            className="mono text-[11px] tracking-[0.12em] uppercase text-(--color-muted) hover:text-(--color-ink)"
          >
            {t('decline')}
          </button>
          <button
            type="button"
            data-testid="consent-accept"
            onClick={() => setConsent('accepted')}
            className="mono text-[11px] tracking-[0.12em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 rounded-full hover:opacity-90"
          >
            {t('accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
