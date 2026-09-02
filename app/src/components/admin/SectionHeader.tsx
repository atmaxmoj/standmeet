// SectionHeader —— the heading block for every admin section.
// design version: kicker (mono uppercase) + title (serif large) + optional count + optional
// action.
//
// The title prop **doesn't accept a string, it accepts a slug**: what a section is called is
// decided by the sidebar's `NAV_GROUPS` (F-N-3). When titles were hand-written, 24 of 26
// sections copied the label exactly and 2 copied it wrong — and those two wrong copies
// (`landing page`->`page` / `custom pages`->`pages`) were exactly the defect of "two names that
// differ by only a plural". Now they're not two strings chasing each other, they're one.

import type { ReactNode } from 'react';

import { navLabel, type AdminSlug } from '@/lib/admin/nav';

type Props = {
  slug: AdminSlug;
  kicker?: string;
  subtitle?: string;
  count?: ReactNode;
  action?: ReactNode;
};

export function SectionHeader(props: Props) {
  return (
    <div
      data-testid="section-header"
      // flex-wrap: on narrow screens the title group and the top-right action button don't fit
      // in one row. Without wrapping, the button's `shrink-0` would squeeze the title into a
      // narrow column of characters (the `+ NEW CODE` field would even overlap the title).
      // With wrapping, the button drops to a second line and no action is lost.
      className="flex flex-wrap items-baseline justify-between border-b border-(--color-rule) pb-4 mb-7 gap-x-6 gap-y-3"
    >
      <SectionHeaderTitle
        title={navLabel(props.slug)}
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
      {/* The title gets its own testid: in the header's text layer, kicker comes before it and
          count comes after, so slicing text to extract the title would break a title like
          `api · mcp` that already contains a separator (F-N-3's guard reads this testid). */}
      <span data-testid="section-title">{title}</span>
      {/* real space so the a11y/text layer reads "raw · 50", not "raw· 50" (UX-12) */}
      {' '}
      <SectionCount count={count} />
    </h1>
  );
}

// The count **gets its own line** on narrow screens. Running inline after the 32px serif title,
// something like `connectors · calendar · mail live · upload your own` would scatter into three
// or four ragged lines, reading as if the title itself had broken. Given a full line of its own,
// it's metadata that reads as one line.
function SectionCount({ count }: { count?: ReactNode }) {
  return count != null
    ? (
      <span className="text-(--color-faint) mono text-[14px] tracking-[0.1em] ml-3 max-sm:block max-sm:ml-0 max-sm:mt-2">
        · {count}
      </span>
    )
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
