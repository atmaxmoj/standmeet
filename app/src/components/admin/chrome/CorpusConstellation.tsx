// CorpusConstellation —— TopBar 中部,替代旧的 ActivityTicker。**外观跟原 ticker 完全一样**
// (统一小字、flowing);只是内容从「活动事件」换成「按链接数排序的语料节点标题」——
// 链接最多的排在前。空显 "no links yet"。

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
