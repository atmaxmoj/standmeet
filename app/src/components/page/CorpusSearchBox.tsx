// CorpusSearchBox —— 访客侧 corpus 搜索框。输入 + Enter → corpus_search → 结果列表(点开 note)/空态。
// ACL 由后端保证(不显示 denied);这里只渲后端返回的命中。逻辑在 @/lib/visitor/corpus-search。

'use client';

import { useState } from 'react';

import { corpusSearch, type CorpusSearchHit } from '@/lib/visitor/corpus-search';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

// genreHref —— 命中 → reader 路由(writing 走 /writings,其余 genre 即路由段)。
function genreHref(hit: CorpusSearchHit): string {
  return hit.genre === 'writing' ? `/writings/${hit.path}` : `/${hit.genre}/${hit.path}`;
}

function Results({ hits }: { hits: CorpusSearchHit[] }): React.ReactElement {
  return hits.length === 0
    ? <p data-testid="corpus-search-empty" className="font-mono text-sm text-(--color-muted)">no results</p>
    : (
      <ul className="mt-2 space-y-1">
        {hits.map((hit) => (
          <li key={`${hit.genre}:${hit.path}`}>
            <a
              data-testid="corpus-search-result"
              href={genreHref(hit)}
              className="text-(--color-accent) hover:underline"
            >{hit.title}</a>
          </li>
        ))}
      </ul>
    );
}

// CorpusSearchBox —— 只对有 session(code/byoai)的访客渲染;public 访客无 corpus 可搜 → null。
// 内部 gate 让宿主(page-shell)无条件渲染,不添加宿主的分支复杂度。
export function CorpusSearchBox(): React.ReactElement | null {
  const session = useVisitorSessionStore((s) => s.session);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CorpusSearchHit[] | null>(null);
  const run = async (): Promise<void> => { setHits(await corpusSearch(query)); };
  return session === null ? null : (
    <div className="my-6">
      <input
        data-testid="corpus-search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { (e.key === 'Enter') && void run(); }}
        placeholder="search the corpus…"
        className="w-full border border-(--color-rule) rounded-[3px] px-3 py-2 font-mono text-sm bg-transparent"
      />
      {hits !== null ? <Results hits={hits} /> : null}
    </div>
  );
}
