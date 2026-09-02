// Contact —— "how to talk to me". chat_line + "jump to chat ↑" (lets the visitor
// jump back to the Hero AskInput), email mailto, one paragraph each for
// recruiter / casual prose.

'use client';

import { useTranslations } from 'next-intl';

import type { PageContact } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

type Props = {
  contact: PageContact;
  onFocusChat: () => void;
};

// The second half of UX-44 suggests "don't render this section when all it
// has left is one line pointing elsewhere" — **do not do that here**.
// `public-page.spec.ts:80` asserts this section still renders with only
// chat_line present, with the rationale written alongside: the chat box that
// line points to genuinely exists, so it isn't an empty pointer. This
// decision has already been made and is pinned by a test; changing it isn't
// a design-column change (it would break an existing assertion) — changing
// it requires first overturning that product decision.
export function Contact({ contact, onFocusChat }: Props) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="how to talk to me" />
      <div className="reading text-(--color-ink) space-y-5 text-[18px]">
        <ChatLine line={contact.chat_line} onFocusChat={onFocusChat} />
        <DirectLine email={contact.email} />
        <MutedProse text={contact.recruiter_prose} />
        <MutedProse text={contact.casual_prose} />
      </div>
    </section>
  );
}

function ChatLine({ line, onFocusChat }: { line: string; onFocusChat: () => void }) {
  const t = useTranslations('page');
  return (
    <p>
      {line}{' '}
      <button
        type="button"
        onClick={onFocusChat}
        className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-accent) border-b border-(--color-accent)/40 hover:border-(--color-accent) transition-colors ml-1"
      >
        {t('contact.jumpToChat')}
      </button>
    </p>
  );
}

// DirectLine —— when email isn't configured, the whole line stays unrendered:
// an "Or directly:" hanging with nothing after it plus an empty mailto is an
// empty shell shown to visitors of an unconfigured instance (same class as
// F-A-21).
function DirectLine({ email }: { email: string }) {
  const t = useTranslations('page');
  return email === '' ? null : (
    <p>
      {t('contact.orDirectly')}{' '}
      <a
        href={`mailto:${email}`}
        className="mono text-(--color-accent) border-b border-(--color-accent)/40 hover:border-(--color-accent) transition-colors text-[15.5px]"
      >
        {email}
      </a>
    </p>
  );
}

// MutedProse —— same as above: an empty paragraph stays unrendered.
function MutedProse({ text }: { text: string }) {
  return text === '' ? null : <p className="text-(--color-muted)">{text}</p>;
}
