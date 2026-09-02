// CorpusSearchRow —— the search box row in the corpus admin.
//
// The status line next to it isn't decoration: the grid underneath can hold
// **two different sets** — "this page + tag filter" or "matches across the
// whole corpus". The two look identical, yet their completeness is entirely
// different (the former is partial, the latter is everything). If the screen
// doesn't say which one it is, the owner will read "not on this page" as "not
// in my corpus" — which is exactly the problem this search is meant to fix
// (F-L-39/40).

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

// Which message to show is derived by `searchMessageKey` (that's the hook
// layer's job); this component only renders it.
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
