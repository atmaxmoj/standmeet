// SectionHeader —— admin 每个 section 的标题块。
// design 版：kicker (mono uppercase) + title (serif large) + 可选 count + 可选 action。
// legacy 版调用方还在传 title / subtitle —— 兼容 fallback。

import type { ReactNode } from 'react';

type Props = {
  title: string;
  kicker?: string;
  subtitle?: string;
  count?: ReactNode;
  action?: ReactNode;
};

export function SectionHeader(props: Props) {
  return (
    <div
      data-testid="section-header"
      className="flex items-baseline justify-between border-b border-(--color-rule) pb-4 mb-7 gap-6"
    >
      <SectionHeaderTitle
        title={props.title}
        kicker={props.kicker}
        subtitle={props.subtitle}
        count={props.count}
      />
      <SectionHeaderAction action={props.action} />
    </div>
  );
}

function SectionHeaderTitle(props: {
  title: string; kicker?: string; subtitle?: string; count?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <SectionKicker text={props.kicker} />
      <SectionTitleLine title={props.title} count={props.count} />
      <SectionSubtitle text={props.subtitle} />
    </div>
  );
}

function SectionTitleLine({ title, count }: { title: string; count?: ReactNode }) {
  return (
    <h1 className="font-serif text-(--color-ink) text-[32px] tracking-[-0.018em] leading-none">
      {title}
      {/* real space so the a11y/text layer reads "raw · 50", not "raw· 50" (UX-12) */}
      {' '}
      <SectionCount count={count} />
    </h1>
  );
}

function SectionCount({ count }: { count?: ReactNode }) {
  return count != null
    ? <span className="text-(--color-faint) mono ml-3 text-[14px] tracking-[0.1em]">· {count}</span>
    : null;
}

function SectionKicker({ text }: { text?: string }) {
  return text
    ? <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1.5">{text}</div>
    : null;
}

function SectionSubtitle({ text }: { text?: string }) {
  return text ? <p className="mono text-xs text-(--color-muted) mt-2">{text}</p> : null;
}

function SectionHeaderAction({ action }: { action?: ReactNode }) {
  return action ? <div className="shrink-0">{action}</div> : null;
}
