// TerminalBox — the "$ standmeet deploy ..." terminal block on the Setup page.
// Scanline + corner crosshair + blink cursor = signals at a glance that this
// is a real self-host deployment, not a SaaS signup.
//
// host comes from a hook (SSR-safe) so the "ready at localhost:38127" line
// shows something real.

'use client';

import { useTranslations } from 'next-intl';

import { useInstanceHash } from '@/lib/auth/use-instance-hash';

export function TerminalBox() {
  const { host } = useInstanceHash();
  const t = useTranslations('auth.terminal');
  return (
    <div className="crosshair scanline border border-(--color-rule) bg-(--color-surface)/60 mt-8 p-4 mono text-[11.5px] leading-[1.7] text-(--color-muted) max-w-[640px]">
      <span className="ch-tl" />
      <span className="ch-br" />
      <div><span className="text-(--color-accent)">{'$'}</span> {t('deploy')}</div>
      <div><span className="text-(--color-faint)">{'├─'}</span> {t('bundling')}</div>
      <div><span className="text-(--color-faint)">{'├─'}</span> {t('provisioning')}</div>
      <div><span className="text-(--color-faint)">{'├─'}</span> {t('exposing')}</div>
      <div>
        <span className="text-(--color-faint)">{'└─'}</span> {t('readyAt')}{' '}
        <span className="text-(--color-ink)">{host || 'localhost'}</span>
      </div>
      <div className="mt-2">
        <span className="text-(--color-accent)">{'$'}</span> {t('awaiting')}
        <span className="blink text-(--color-accent)">_</span>
      </div>
    </div>
  );
}
