// SectionHeader —— admin 每个 section 的标题块。
// design 版：kicker (mono uppercase) + title (serif large) + 可选 count + 可选 action。
//
// 标题**不收字符串，收 slug**：这一节叫什么由侧栏那份 `NAV_GROUPS` 说了算（F-N-3）。
// 手写标题的时候，26 节里有 24 节抄得跟牌子一模一样，剩下两节抄错了 —— 而错的那两节
// (`landing page`→`page` / `custom pages`→`pages`) 恰好是"两个名字只差一个复数"这个
// 缺陷本身。现在它们不是两份互相追赶的字符串，而是同一份。

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
      // flex-wrap：窄屏上标题这一组和右上角那个动作按钮放不进一行。不换行的话按钮
      // `shrink-0` 会把标题挤成一列窄字（`+ NEW CODE` 那格甚至压在标题上面）。
      // 换行之后按钮落到第二行，一个动作都不少。
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
      {/* 标题单独挂 testid：header 的文本层里 kicker 在前、count 在后，靠切分取标题
          会把 `api · mcp` 这种本身带分隔符的标题切坏（F-N-3 的守卫要读的就是它）。 */}
      <span data-testid="section-title">{title}</span>
      {/* real space so the a11y/text layer reads "raw · 50", not "raw· 50" (UX-12) */}
      {' '}
      <SectionCount count={count} />
    </h1>
  );
}

// 计数在窄屏上**自成一行**。跟在 32px 衬线标题后面走内联时，`connectors ·
// calendar · mail live · upload your own` 这种会散成三四行长短不一的碎块，
// 读起来像标题本身断了。占一整行之后它是一行读得完的元数据。
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
