// Contact —— "how to talk to me"。chat_line + "jump to chat ↑"（让 visitor
// 跳回 Hero AskInput），email mailto，recruiter / casual prose 各一段。

'use client';

import { useTranslations } from 'next-intl';

import type { PageContact } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

type Props = {
  contact: PageContact;
  onFocusChat: () => void;
};

// UX-44 的后半句提过「这一区只剩一句指路时就别渲染了」—— **不要那么做**。
// `public-page.spec.ts:80` 断言这一区在只有 chat_line 时仍然在，旁边写着理由：
// 那句话指向的聊天框是真实存在的，所以它不是空指路。这个决定已经做过并且被测试钉住了；
// 改它不属于设计列（会改掉一条现有断言），要改得先推翻那个产品决定。
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

// DirectLine —— email 没配就整行不渲："Or directly:" 空挂着 + 空 mailto 是
// 未配置实例给 visitor 看的空壳（F-A-21 同类）。
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

// MutedProse —— 同上：空段落不渲。
function MutedProse({ text }: { text: string }) {
  return text === '' ? null : <p className="text-(--color-muted)">{text}</p>;
}
