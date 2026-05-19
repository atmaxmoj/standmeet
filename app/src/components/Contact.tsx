// Contact —— "how to talk to me"。chat_line + "jump to chat ↑"（让 visitor
// 跳回 Hero AskInput），email mailto，recruiter / casual prose 各一段。

'use client';

import type { PageContact } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

type Props = {
  contact: PageContact;
  onFocusChat: () => void;
};

export function Contact({ contact, onFocusChat }: Props) {
  return (
    <section className="mt-24">
      <DeckHeader kicker="how to talk to me" />
      <div className="reading text-(--color-ink) space-y-5" style={{ fontSize: '18px' }}>
        <ChatLine line={contact.chat_line} onFocusChat={onFocusChat} />
        <DirectLine email={contact.email} />
        <p className="text-(--color-muted)">{contact.recruiter_prose}</p>
        <p className="text-(--color-muted)">{contact.casual_prose}</p>
      </div>
    </section>
  );
}

function ChatLine({ line, onFocusChat }: { line: string; onFocusChat: () => void }) {
  return (
    <p>
      {line}{' '}
      <button
        type="button"
        onClick={onFocusChat}
        className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-accent) border-b border-(--color-accent)/40 hover:border-(--color-accent) transition-colors ml-1"
      >
        jump to chat ↑
      </button>
    </p>
  );
}

function DirectLine({ email }: { email: string }) {
  return (
    <p>
      Or directly:{' '}
      <a
        href={`mailto:${email}`}
        className="mono text-(--color-accent) border-b border-(--color-accent)/40 hover:border-(--color-accent) transition-colors"
        style={{ fontSize: '15.5px' }}
      >
        {email}
      </a>
    </p>
  );
}
