// Insights —— "things I've been thinking about"。一行 thesis + 一行
// "── context" + 点开展开 body。设计稿语义：每个 insight 都默认折叠，
// caller 通过 expanded:Set<string> 控制；让 visitor 自主决定深度。

'use client';

import { useCallback, useState } from 'react';

import type { PageInsight } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Insights({ insights }: { insights: readonly PageInsight[] }) {
  const { expanded, toggle } = useExpanded();
  return (
    <section className="mt-24">
      <DeckHeader kicker="things I've been thinking about" count={insights.length} />
      <ol className="space-y-7">
        {insights.map((it, idx) => (
          <InsightRow key={it.id} idx={idx} insight={it} open={expanded.has(it.id)} onToggle={toggle} />
        ))}
      </ol>
    </section>
  );
}

function useExpanded(): { expanded: ReadonlySet<string>; toggle: (id: string) => void } {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string): void => {
    setExpanded((prev) => toggleInSet(prev, id));
  }, []);
  return { expanded, toggle };
}

function toggleInSet(prev: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(prev);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

type RowProps = {
  idx: number;
  insight: PageInsight;
  open: boolean;
  onToggle: (id: string) => void;
};

function InsightRow({ idx, insight, open, onToggle }: RowProps) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-5">
      <span className="mono text-[10px] tracking-[0.14em] text-(--color-faint) tabular-nums pt-2.5">
        {String(idx + 1).padStart(2, '0')}
      </span>
      <div>
        <button type="button" onClick={() => onToggle(insight.id)} className="group w-full text-left">
          <InsightThesis text={insight.thesis} />
          <InsightContext context={insight.context} open={open} />
        </button>
        {open && <InsightBody body={insight.body} />}
      </div>
    </li>
  );
}

function InsightThesis({ text }: { text: string }) {
  return (
    <p
      className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors"
      style={{ fontSize: '20px', lineHeight: 1.4, fontWeight: 500, letterSpacing: '-0.005em' }}
    >
      {text}
    </p>
  );
}

function InsightContext({ context, open }: { context: string; open: boolean }) {
  return (
    <p
      className="mono text-(--color-faint) mt-1.5"
      style={{ fontSize: '11px', letterSpacing: '0.04em' }}
    >
      ── {context}
      <span
        className={`ml-3 transition-colors ${open ? 'text-(--color-accent)' : 'text-(--color-faint) group-hover:text-(--color-muted)'}`}
      >
        {open ? '[ close ]' : '[ read more ]'}
      </span>
    </p>
  );
}

function InsightBody({ body }: { body: string }) {
  return (
    <p
      className="reading text-(--color-muted) mt-4 fadein"
      style={{ fontSize: '16.5px', maxWidth: '38em' }}
    >
      {body}
    </p>
  );
}
