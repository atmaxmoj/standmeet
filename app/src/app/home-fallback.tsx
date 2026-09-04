// home-fallback.tsx — what `/` renders when there is NO live custom `home` page yet.
//
// The homepage is now a custom page (installed at claim, auto-promoted to live the moment its build
// finishes), served at `/` by the middleware. This component is only the FALLBACK for the narrow
// windows where no live home exists: the seconds between claim and the first build finishing, or a
// build that failed. So it's deliberately minimal — the owner's identity and a way in — not the old
// editable long-scroll (PageContent/PageShell, removed in A Slice 5).

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function HomeFallback({ name, handle }: { name: string; handle: string }) {
  const t = useTranslations('page');
  return (
    <main className="mx-auto max-w-[640px] px-6 min-h-screen flex flex-col justify-center">
      <div className="mono text-[10.5px] tracking-[0.22em] uppercase text-(--color-muted) mb-5 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent)" />
        {name || handle}
      </div>
      <p className="font-serif text-(--color-ink) text-[clamp(22px,3vw,30px)] leading-[1.35] font-[380] tracking-[-0.01em] max-w-[24ch]">
        {t('fallback.settingUp')}
      </p>
      <div className="mt-8">
        <Link
          href="/gate"
          className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent) hover:tracking-[0.2em] transition-all"
        >
          {t('fallback.enter')}
        </Link>
      </div>
    </main>
  );
}
