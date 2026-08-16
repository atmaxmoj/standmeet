// CorpusSearchRow —— 语料后台的搜索框那一行。
//
// 它旁边那句状态不是装饰：这个网格下面可能装着**两种集合** —— 「这一页 + 标签筛」
// 或者「全库命中」。两种长得一模一样，而它们的完备性完全不同（前者是局部，后者是全部）。
// 屏幕不说清楚是哪一种，owner 就会把「这一页里没有」读成「我的语料里没有」——
// 那正是这条搜索要治的病（F-L-39/40）。

'use client';

import { useTranslations } from 'next-intl';

import { searchMessageKey, type CorpusSearchHook } from '@/lib/admin/use-corpus-search';

export function CorpusSearchRow({ hook }: { hook: CorpusSearchHook }) {
  const t = useTranslations('adminCorpus.search');
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1">
        <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">
          {t('label')}
        </span>
        <input
          type="search"
          value={hook.query}
          onChange={(e) => hook.setQuery(e.target.value)}
          placeholder={t('placeholder')}
          data-testid="corpus-search-input"
          className="flex-1 bg-transparent mono py-1.5 text-[13px] text-(--color-ink) placeholder:text-(--color-faint)"
        />
      </div>
      <SearchState hook={hook} />
    </div>
  );
}

// 说哪句话由 `searchMessageKey` 推导（那是 hook 那一层的事）；这里只负责渲。
function SearchState({ hook }: { hook: CorpusSearchHook }) {
  const t = useTranslations('adminCorpus.search');
  const { key, values } = searchMessageKey(hook);
  const tone = hook.active ? 'text-(--color-muted)' : 'text-(--color-faint)';
  return (
    <p className={`mono text-[10px] ${tone} mt-1.5`} data-testid="corpus-search-state">
      {t(key, values)}
    </p>
  );
}
