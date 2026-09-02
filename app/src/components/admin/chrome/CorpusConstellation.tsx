// CorpusConstellation — center of the TopBar, replaces the old ActivityTicker.
// **Looks exactly like the original ticker** (same small mono type, flowing);
// only the content changes, from "activity events" to "corpus node titles sorted
// by link count" — most-linked first. Shows "no links yet" when empty.

'use client';

import { useTranslations } from 'next-intl';

import { useCorpusGraph } from '@/lib/admin/use-corpus-graph';

export function CorpusConstellation() {
  const t = useTranslations('adminShell.constellation');
  const nodes = useCorpusGraph();
  return (
    <div
      data-testid="corpus-constellation"
      className="ticker-host flex-1 min-w-0 overflow-hidden mx-6 flex gap-4 items-center"
    >
      {nodes.length === 0
        ? <span className="mono text-[10px] tracking-[0.14em] text-(--color-faint)">{t('empty')}</span>
        : nodes.map((n) => (
          <span
            key={n.id}
            className="mono text-[10px] tracking-[0.14em] text-(--color-muted) whitespace-nowrap"
          >
            {n.title}
          </span>
        ))}
    </div>
  );
}
