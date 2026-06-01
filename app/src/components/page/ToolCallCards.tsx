// ToolCallCards —— G-4: 渲 Dialog.toolCalls per tool name。
//
// dispatch 表：
//   - corpus_search / corpus_list  → SearchHitsCard (path+title+summary 列表)
//   - corpus_read                  → skip (Citation 已渲，重复)
//   - calendar_book                → skip (G-7 单独 confirmation card)
//   - skill_* / ext_*              → GenericDumpCard (debug-grade JSON 框)
//   - 其他                          → null (不渲，避免 chat 噪声)
//
// 位置：ConversationDeck / ChatRoom 渲 answer paras 之前 (transcript flow
// 上："tool 卡 → answer 文本 → citations" 的纵向顺序)。
//
// 数据 narrow 在 lib/page/tool-call-shape.ts；presentation 层只做渲染。

'use client';

import {
  pickSearchHits, shouldRenderCall, cardKindFor, jsonPretty,
  type SearchHit,
} from '@/lib/page/tool-call-shape';
import type { ToolCallView } from '@/lib/page/use-chat';
import styles from '@/components/page/ToolCallCards.module.css';

export function ToolCallCards({ calls }: { calls: readonly ToolCallView[] }) {
  const visible = calls.filter(shouldRenderCall);
  return visible.length === 0 ? null : (
    <div className={styles['stack']} data-testid="tool-call-cards">
      {visible.map((c, i) => <ToolCallCard key={`${c.name}-${i}`} call={c} />)}
    </div>
  );
}

const CARD_RENDERERS: Record<'search' | 'dump', (c: ToolCallView) => React.ReactElement | null> = {
  search: (call) => <SearchHitsCard call={call} />,
  dump:   (call) => <GenericDumpCard call={call} />,
};

function ToolCallCard({ call }: { call: ToolCallView }) {
  const kind = cardKindFor(call.name);
  return kind === 'none' ? null : CARD_RENDERERS[kind](call);
}

function SearchHitsCard({ call }: { call: ToolCallView }) {
  const hits = pickSearchHits(call.result);
  return hits.length === 0 ? null : (
    <div
      className={styles['searchCard']}
      data-testid={`tool-card-${call.name}`}
    >
      <div className={styles['kicker']}>
        {call.name === 'corpus_list' ? 'browsed' : 'searched'} · {hits.length} entries
      </div>
      <ul className={styles['hits']}>
        {hits.map((h) => <SearchHitRow key={h.path} h={h} />)}
      </ul>
    </div>
  );
}

function SearchHitRow({ h }: { h: SearchHit }) {
  return (
    <li className={styles['hit']} data-testid="tool-card-hit" data-path={h.path}>
      <span
        className={`${styles['genre']} ${h.genre === 'output' ? styles['genreOutput'] : ''}`}
      >
        {h.genre}
      </span>
      <span className={styles['title']}>{h.title}</span>
      {h.summary && <span className={styles['summary']}>{h.summary}</span>}
    </li>
  );
}

// GenericDumpCard —— skill_* / ext_* tool 结果。debug-grade JSON pretty
// dump；让 owner 观察 visitor 这边到底跑了啥；不强调视觉。
function GenericDumpCard({ call }: { call: ToolCallView }) {
  return (
    <div className={styles['genericCard']} data-testid={`tool-card-${call.name}`}>
      <div className={styles['kicker']}>{call.name}</div>
      <pre className={styles['dump']}>{jsonPretty(call.result)}</pre>
    </div>
  );
}
