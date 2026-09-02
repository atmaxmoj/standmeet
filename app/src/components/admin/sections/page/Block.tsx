// Block — section card in the Page editor: title + subtitle + content.

import type { ReactNode } from 'react';

type Props = { title: string; blurb?: string; children: ReactNode };

export function Block({ title, blurb, children }: Props) {
  return (
    <section className="border-t border-(--color-rule) pt-10 mt-10 first:border-0 first:pt-0 first:mt-0">
      <BlockHead title={title} blurb={blurb} />
      <div className="space-y-7">{children}</div>
    </section>
  );
}

function BlockHead({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="mb-7 flex items-baseline gap-4 flex-wrap">
      <h2 className="font-serif text-(--color-ink) text-[22px] font-medium tracking-[-0.012em]">{title}</h2>
      <Blurb text={blurb} />
    </div>
  );
}

function Blurb({ text }: { text?: string }) {
  return text
    ? <p className="reading-tight text-(--color-muted) flex-1 min-w-[20em] text-[14px] max-w-[46em]">{text}</p>
    : null;
}
