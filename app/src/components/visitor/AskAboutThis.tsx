// AskAboutThis —— the follow-up input bar under the article/landing on
// blog/[slug] / wiki/[...path] / output/[...path]. Submit goes through
// GET `/?q=<question>` → root PageShell's useConsumeQuestionFromURL feeds it
// into chat, then replaceState clears the URL.
//
// Shared across three surfaces: blog (essay) / wiki (corpus entry) /
// output (polished). kind only affects the header copy — structure and
// behavior are identical.
//
// Design source: docs/design/project/blog.js AskAboutThis +
// docs/design/project/wiki.js sticky ask bar.

import Link from 'next/link';
import { useTranslations } from 'next-intl';

type Kind = 'essay' | 'wiki' | 'output';

interface Props {
  title: string;
  kind?: Kind;
}

export function AskAboutThis({ title, kind = 'essay' }: Props) {
  return (
    <section className="mt-10 pt-3 pb-4 border-t border-(--color-rule)" data-testid="ask-about-this">
      <div className="max-w-[760px] mx-auto px-6 lg:px-0">
        <AskHeader title={title} kind={kind} />
        <AskForm placeholderTitle={title} />
        <AskStarters title={title} kind={kind} />
      </div>
    </section>
  );
}

function AskHeader({ title, kind }: { title: string; kind: Kind }) {
  const t = useTranslations('visitor.askAboutThis');
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3 flex-wrap">
      <span className="text-(--color-ink)">{t('header', { label: t(labelKeyFor(kind)) })}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{t('context', { title: title.toLowerCase() })}</span>
    </div>
  );
}

// labelKeyFor —— kind → catalog key (essay / entry / piece); the catalog
// resolves the actual word.
function labelKeyFor(kind: Kind): 'essay' | 'entry' | 'piece' {
  return kind === 'essay' ? 'essay' : kind === 'wiki' ? 'entry' : 'piece';
}

function AskForm({ placeholderTitle }: { placeholderTitle: string }) {
  const t = useTranslations('visitor.askAboutThis');
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
        {t('ask')}
      </button>
    </form>
  );
}

function AskStarters({ title, kind }: { title: string; kind: Kind }) {
  const t = useTranslations('visitor.common');
  const starters = startersFor(title, kind);
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-1 gap-y-1.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mr-3 pt-0.5">
        {t('try')}
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
