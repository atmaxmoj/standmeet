// Insights section —— thesis （强）+ context（小 caps）+ body（reading 段）。

import type { PageInsight } from '@/lib/api/public';

export function Insights({ insights }: { insights: PageInsight[] }) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 space-y-12">
      <SectionLabel text="insights" />
      {insights.map((it) => <InsightItem key={it.id} insight={it} />)}
    </section>
  );
}

function InsightItem({ insight }: { insight: PageInsight }) {
  return (
    <article className="space-y-3">
      <h3 className="reading reading-tight text-xl font-medium">{insight.thesis}</h3>
      <p className="smallcaps">{insight.context}</p>
      <p className="reading text-base">{insight.body}</p>
    </article>
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
