// AskAboutThis —— visitor 在 blog/[slug] / wiki/[...path] / output/[...path]
// 文章/landing 底下 follow-up 输入条。submit 走 GET `/?q=<question>` →
// root PageShell 的 useConsumeQuestionFromURL 落地自动喂进 chat 后 replaceState
// 清 URL。
//
// 三种 surface 共用：blog (essay) / wiki (corpus entry) / output (polished)。
// kind 只影响 header 文案，结构 + 行为完全一致。
//
// 设计源 docs/design/project/blog.js AskAboutThis (490-540) +
// docs/design/project/wiki.js sticky ask bar (250-278)。

import Link from 'next/link';

type Kind = 'essay' | 'wiki' | 'output';

interface Props {
  title: string;
  kind?: Kind;
}

export function AskAboutThis({ title, kind = 'essay' }: Props) {
  return (
    <section className="mt-10 pt-3 pb-4 border-t border-(--color-rule)">
      <div className="max-w-[760px] mx-auto px-6 lg:px-0">
        <AskHeader title={title} kind={kind} />
        <AskForm placeholderTitle={title} />
        <AskStarters title={title} kind={kind} />
      </div>
    </section>
  );
}

function AskHeader({ title, kind }: { title: string; kind: Kind }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3 flex-wrap">
      <span className="text-(--color-ink)">ask the AI about this {labelFor(kind)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>context: &ldquo;{title.toLowerCase()}&rdquo;</span>
    </div>
  );
}

function labelFor(kind: Kind): string {
  return kind === 'essay' ? 'essay' : kind === 'wiki' ? 'entry' : 'piece';
}

function AskForm({ placeholderTitle }: { placeholderTitle: string }) {
  return (
    <form
      method="get"
      action="/"
      className="flex items-baseline gap-4 py-3 border-t border-b border-(--color-ink)"
      data-testid="article-ask-form"
    >
      <span className="text-(--color-accent) font-serif shrink-0 text-[24px] leading-none">›</span>
      <input
        type="text"
        name="q"
        placeholder={`follow-up question about "${placeholderTitle.toLowerCase()}"…`}
        className="flex-1 bg-transparent font-serif italic min-w-0 text-[20px] leading-[1.3] font-[380] text-(--color-ink) placeholder:text-(--color-faint)"
        autoComplete="off"
      />
      <input type="hidden" name="from" value={placeholderTitle} />
      <button
        type="submit"
        className="mono text-[11px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors shrink-0"
      >
        ask ↵
      </button>
    </form>
  );
}

function AskStarters({ title, kind }: { title: string; kind: Kind }) {
  const starters = startersFor(title, kind);
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-1 gap-y-1.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mr-3 pt-0.5">
        try
      </span>
      {starters.map((s, i) => (
        <StarterLink key={s} text={s} sep={i < starters.length - 1} />
      ))}
    </div>
  );
}

function startersFor(title: string, kind: Kind): string[] {
  const lower = title.toLowerCase();
  const wiki = [
    `What's the practical takeaway from "${lower}"?`,
    `Where does this show up in the owner's current work?`,
    `Has he changed his mind on any of this?`,
  ];
  const essay = [
    `What's the practical takeaway from "${lower}"?`,
    `How does this relate to the owner's current work?`,
  ];
  return kind === 'wiki' ? wiki : essay;
}

function StarterLink({ text, sep }: { text: string; sep: boolean }) {
  return (
    <span>
      <Link
        href={`/?q=${encodeURIComponent(text)}`}
        className="font-serif italic text-(--color-muted) hover:text-(--color-accent) transition-colors text-[15px]"
      >
        &ldquo;{text}&rdquo;
      </Link>
      {sep && <span className="text-(--color-faint) not-italic mx-1.5">/</span>}
    </span>
  );
}
