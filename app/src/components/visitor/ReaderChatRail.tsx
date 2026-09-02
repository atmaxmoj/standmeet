// ReaderChatRail —— the right-hand column of the reader: **ask about this
// article**.
//
// Why it has to stay always on, rather than being the floating round
// button in the bottom-right corner:
//
// The floating button only appears when a **session already exists**
// (`useVisitorChatAvailable()` is just `session !== null`). So a reader who
// never entered a code and never filled in their own key sees no trace of
// "you can ask" anywhere on the whole wiki page — the only place it's
// mentioned is the card at the very bottom of the body, which requires
// scrolling all the way down to see. The product's entire thesis is "the
// corpus is here to be asked about", and this entry point is invisible at
// exactly the moment it's needed.
//
// So the right rail renders in both states:
//   · with a session → it's the chat itself
//   · without a session → filling in your own key (BYOAI) **right there**
//     is enough to start asking; it reuses the form from `/gate`, no
//     second copy (the same thing implemented twice means a change to one
//     misses the other)
//
// The position is symmetric with the tree on the left: the left says
// "what's in this corpus", the right says "what can I ask about just this
// article", and the body stays put in the middle. Neither side renders on
// narrow screens — the cost of squeezing them in would be an unreadable
// body — and the floating button in the bottom-right corner is still there
// then (it was built for the narrow-screen shape in the first place).

'use client';

import { useTranslations } from 'next-intl';

import { BYOAIPanel } from '@/components/gate/BYOAIPanel';
import { useGate } from '@/lib/gate/use-gate';
import { useVisitorChatAvailable } from '@/lib/visitor/session-store';

import styles from '@/components/visitor/ReaderChatRail.module.css';

export function ReaderChatRail({ children }: { children: React.ReactNode }) {
  const canAsk = useVisitorChatAvailable();
  return (
    <aside className={styles['rail']} data-testid="reader-chat-rail">
      {canAsk ? children : <ByoaiInvite />}
    </aside>
  );
}

// ByoaiInvite —— what's in the right rail when there's no session: one
// sentence explaining what's possible here, then a key input field **right
// on this spot**.
//
// Not a link jumping to /gate: the reader is right now reading a specific
// article, and bouncing them away means they lose that context — by the
// time they come back, the impulse is gone.
function ByoaiInvite() {
  const t = useTranslations('visitor.readerChat');
  const hook = useGate();
  return (
    <div className={styles['invite']} data-testid="reader-chat-byoai">
      <div className={styles['kicker']}>{t('kicker')}</div>
      <h2 className={styles['heading']}>{t('heading')}</h2>
      <p className={styles['lede']}>{t('lede')}</p>
      <BYOAIPanel hook={hook} />
    </div>
  );
}
