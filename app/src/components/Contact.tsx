// Contact section —— email + chat line + recruiter / casual prose。

import type { PageContact } from '@/lib/api/public';

export function Contact({ contact }: { contact: PageContact }) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 pb-48 space-y-6">
      <SectionLabel text="how to talk to me" />
      <p className="reading">
        <a className="link" href={`mailto:${contact.email}`}>{contact.email}</a>
      </p>
      <p className="reading">{contact.chat_line}</p>
      <p className="reading">{contact.recruiter_prose}</p>
      <p className="reading">{contact.casual_prose}</p>
    </section>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <header className="flex items-center gap-4">
      <span className="smallcaps">{text}</span>
      <hr className="rule rule-soft flex-1" />
    </header>
  );
}
