// ReaderAboutCard —— the "what this is, what you can do with it" card at
// the bottom of a reader page.
//
// **What it says must be something this visitor can actually do.** The
// card used to unconditionally say "ask follow-ups below", while the
// chat entry point (FloatingChatDock) doesn't render at all for a visitor
// with no session — an anonymous reader would read a promise that this
// very page had already falsified (UX-86).
//
// So "can they keep asking" has exactly one criterion —
// `useVisitorChatAvailable()`, read by both the dock and this card. When
// they can't, the card doesn't stay silent — it points to the path they
// can actually take: go to `/gate` and enter a code
// ([[gate-handoff-no-inline-chat]]).
//
// Both genres share this one card: wiki and output used to each have their
// own copy (with different wording, too), and once this rule is split into
// two copies, the next change only ever reaches one of them.

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { pageAllowsBYOAI, publicChatEnabled } from '@standmeet/sdk-core';
import { useVisitorChatAvailable } from '@standmeet/sdk';

// useReaderCanAsk —— "can they keep asking" = a session, OR a tier they can ask on with no code: the
// owner's public tier, or bringing their own key (both offered by the reader's chat rail). Read after
// mount (the meta the layout injects); until then the card stays on the gated copy, correct for SSR
// and for a reader with none. Without it, the card would tell a reader to "enter a code" while the
// rail beside it already answers them.
function useReaderCanAsk(): boolean {
  const hasSession = useVisitorChatAvailable();
  const [tierOk, setTierOk] = useState(false);
  useEffect(() => { setTierOk(publicChatEnabled() || pageAllowsBYOAI()); }, []);
  return hasSession || tierOk;
}

export function ReaderAboutCard({ genre, handle }: { genre: 'wiki' | 'output'; handle: string }) {
  const t = useTranslations('reader');
  const canAsk = useReaderCanAsk();
  return (
    <div
      data-testid="reader-about"
      className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50"
    >
      <div className="smallcaps mb-1.5">{t(`${genre}.aboutHeading`)}</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        {t(canAsk ? `${genre}.aboutBody` : `${genre}.aboutBodyGated`, { handle })}
        {!canAsk && <GateLink />}
      </p>
    </div>
  );
}

// GateLink —— gives the path they can actually take. Once the card names
// an action, it must hand over the way to do it — otherwise the reader has
// to go find the door themselves (the inverse of
// [[button-that-cannot-be-wired]]).
function GateLink() {
  const t = useTranslations('reader');
  return (
    <>
      {' '}
      <Link href="/gate" className="text-(--color-accent) underline underline-offset-2">
        {t('enterAccessCode')}
      </Link>
    </>
  );
}
