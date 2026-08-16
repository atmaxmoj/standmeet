// use-corpus-search —— 后台「按内容找一条」。
//
// 为什么它得存在（F-L-39/40/41）：语料上千条，而这一侧原先只有标签 chip 和一个两列网格。
// 要打开一条**名字已知**的笔记，owner 得先猜它挂了哪些标签，筛完还剩几十条，再用眼睛扫。
// 我在审计里为了找一条笔记连开四次页面、筛两个标签、翻两屏都没找到 —— 而访客那一侧
// 一直有搜索。后端的全文检索也一直在（`repo.*.Search`），缺的只是 owner 这一侧的接线。
//
// 形状跟列表**同一种行**（`WikiSummary`），所以搜索结果直接喂给同一个网格，
// 不必为「搜出来的东西」再写一套卡片。

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { WikiSummarySchema, type WikiSummary } from '@/lib/admin/use-wiki';

// 停顿多久才发请求。**不是省流量**：一边打字一边发，回来的顺序不保证，
// 后到的旧结果会盖掉新结果 —— 那是「搜到的东西跟输入框对不上」的经典来源。
const DEBOUNCE_MS = 250;

export type CorpusSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CorpusSearchHook {
  query: string;
  setQuery: (q: string) => void;
  status: CorpusSearchStatus;
  rows: readonly WikiSummary[];
  error: string | null;
  /** active —— 输入框里有词：网格该显示搜索结果而不是那一页列表。 */
  active: boolean;
}

/**
 * searchMessageKey —— 这一刻该说哪句话 + 那句话要的值。
 *
 * 放在 hook 这一层而不是组件里：**「现在是什么状态」是推导，不是渲染**。
 * 组件只负责把 key 交给 i18n。（表现层不许写 `if` —— 那条 lint 规则说的就是这件事。）
 */
export function searchMessageKey(hook: CorpusSearchHook): {
  key: string; values: Record<string, string | number>;
} {
  const query = hook.query.trim();
  const byStatus: Record<CorpusSearchStatus, { key: string; values: Record<string, string | number> }> = {
    idle: { key: 'idleHint', values: {} },
    loading: { key: 'searching', values: {} },
    error: { key: 'failed', values: { reason: hook.error ?? '' } },
    // 一页封顶时**不许说「共 N 条」** —— 那个 N 是这一页的行数，不是命中总数。
    // 「50 entries match」在真语料上正好撞满上限，而 owner 会把它读成总数
    // （[[names-that-lie]]：标签声称了它并不追踪的东西）。
    ready: readyMessage(hook.rows.length, query),
  };
  return hook.active ? byStatus[hook.status] : byStatus.idle;
}

// PAGE_LIMIT —— 服务端一页的上限（`corpus.search` 的默认窗口）。行数等于它 = **可能还有**，
// 所以那一刻的措辞必须换。
const PAGE_LIMIT = 50;

function readyMessage(count: number, query: string): {
  key: string; values: Record<string, string | number>;
} {
  const byShape: Record<'none' | 'capped' | 'all', { key: string; values: Record<string, string | number> }> = {
    none: { key: 'none', values: { query } },
    capped: { key: 'foundCapped', values: { count, query } },
    all: { key: 'found', values: { count, query } },
  };
  return byShape[searchShape(count)];
}

function searchShape(count: number): 'none' | 'capped' | 'all' {
  return count === 0 ? 'none' : (count >= PAGE_LIMIT ? 'capped' : 'all');
}

export function useCorpusSearch(genre: string): CorpusSearchHook {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CorpusSearchStatus>('idle');
  const [rows, setRows] = useState<readonly WikiSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  // seq —— 只认最后一次发出去的那一次。**没有它就会有过期结果盖新结果**。
  const seq = useRef(0);

  const run = useCallback(async (q: string, mine: number) => {
    try {
      const found = await adminAPI.get(
        `/corpus/${genre}/search?q=${encodeURIComponent(q)}`,
        z.array(WikiSummarySchema),
      );
      if (seq.current !== mine) return;
      setRows(found);
      setStatus('ready');
    } catch (e) {
      if (seq.current !== mine) return;
      setError(e instanceof Error ? e.message : 'search failed');
      setStatus('error');
    }
  }, [genre]);

  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      seq.current += 1;
      setStatus('idle');
      setRows([]);
      setError(null);
      return undefined;
    }
    setStatus('loading');
    setError(null);
    const mine = seq.current + 1;
    seq.current = mine;
    const t = setTimeout(() => { void run(q, mine); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, run]);

  return { query, setQuery, status, rows, error, active: query.trim() !== '' };
}
