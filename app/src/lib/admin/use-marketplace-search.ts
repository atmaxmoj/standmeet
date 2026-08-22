// use-marketplace-search —— /api/admin/marketplace/search fetcher with
// (query, source) state + pagination (#48-4). The backend pages the aggregated
// GitHub + SkillsMP results; loadMore appends the next page.
//
// Backend returns []domain.MarketSkill — we adapt to the frontend
// MarketSkillView shape (camelCase fields, design-aligned).

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import { z } from 'zod';

import type { MarketSkillView, SkillCategory } from '@/lib/admin/agent-skills-types';
import { safeJson } from '@/lib/api/typed-json';

const PAGE_LIMIT = 12;

const MarketSkillWireSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string(),
  version: z.string(),
  category: z.string(),
  description: z.string(),
  source_url: z.string(),
  source: z.enum(['github', 'skillsmp']),
  // repo_stars —— null 就是 null(这个源报不出星数)。不许 `.default(0)`:那正是
  // 每张 GitHub 卡片印出 `★ 0` 的那一步 —— 把"不知道"翻译成了"零颗星"(F-F-2)。
  repo_stars: z.number().nullish(),
  // needs —— 这个 skill 要用的工具背后、owner **还没连**的连接器名（'calendar' / 'smtp'）。
  //   null / 缺席 = 服务端答不上来（没读过它的 SKILL.md，或这台实例解析不了）→ 卡片不说话；
  //   []          = 答得上，不缺；
  //   [...]       = 缺这几个。
  // **差集在服务端做**：「这个技能要什么」和「owner 连了什么」两半都在那边，客户端再算一遍
  // 就得自己维护一张连接器→标签的对照表，那是同一件事的第三种叫法（F-F-4）。
  needs: z.array(z.string()).nullish(),
});

const MarketSkillsResponseSchema = z.array(MarketSkillWireSchema);

type MarketSkillWire = z.infer<typeof MarketSkillWireSchema>;

export type SourceParam = 'all' | 'github' | 'skillsmp';

interface State {
  results: readonly MarketSkillView[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}

export interface MarketplaceSearch extends State {
  loadMore: () => void;
}

const INIT_STATE: State = { results: [], loading: true, error: null, hasMore: false };

export function useMarketplaceSearch(query: string, source: SourceParam): MarketplaceSearch {
  const [state, setState] = useState<State>(INIT_STATE);
  // seq —— 最后发出去的那一发说了算。没有它的时候，**先发的回得晚就会赢**：
  // 空查询的整份目录压在刚搜出来的结果上面，而搜索框里还写着 owner 打的那个词，
  // 没有任何一处报错（F-F-6）。连接器列表那边一直有这件事（useLatestList），这里漏了。
  const seq = useRef(0);
  useEffect(() => {
    void loadPage(query, source, 0, [], setState, seq);
  }, [query, source]);
  const loadMore = useCallback(() => {
    if (state.loading || !state.hasMore) return;
    void loadPage(query, source, state.results.length, state.results, setState, seq);
  }, [query, source, state.loading, state.hasMore, state.results]);
  return { ...state, loadMore };
}

async function loadPage(
  query: string, source: SourceParam, offset: number,
  prev: readonly MarketSkillView[], setState: (s: State) => void,
  seq: MutableRefObject<number>,
): Promise<void> {
  const ticket = ++seq.current;
  setState({ results: prev, loading: true, error: null, hasMore: false });
  const next = await fetchState(query, source, offset, prev);
  // 回来的时候已经有更新的一发了 → 这一份是旧闻，扔掉。**失败也一样扔**：
  // 一发被取代的请求报的错，说的不是屏幕上现在这个查询的事。
  if (ticket !== seq.current) return;
  setState(next);
}

// fetchState —— 一发请求的结果（成功或失败）折成一个 State。跟「要不要采用它」分开，
// 是为了让上面那句「最后一发说了算」只有一个判断点。
async function fetchState(
  query: string, source: SourceParam, offset: number, prev: readonly MarketSkillView[],
): Promise<State> {
  try {
    const wire = await fetchMarket(query, source, offset);
    const page = wire.map(adapt);
    return {
      results: offset === 0 ? page : [...prev, ...page],
      loading: false, error: null, hasMore: wire.length >= PAGE_LIMIT,
    };
  } catch (e) {
    return { results: prev, loading: false, error: searchErrMsg(e), hasMore: false };
  }
}

function searchErrMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'marketplace search failed';
}

async function fetchMarket(
  query: string, source: SourceParam, offset: number,
): Promise<readonly MarketSkillWire[]> {
  const url = new URL('/api/admin/marketplace/search', window.location.origin);
  if (query) url.searchParams.set('q', query);
  if (source !== 'all') url.searchParams.set('source', source);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  url.searchParams.set('offset', String(offset));
  const res = await fetch(url.toString(), { credentials: 'include' });
  if (!res.ok) throw new Error(`marketplace search: ${res.status}`);
  return safeJson(res, MarketSkillsResponseSchema);
}

function adapt(w: MarketSkillWire): MarketSkillView {
  return {
    id: w.id,
    name: w.name,
    author: w.author,
    repoStars: w.repo_stars ?? null,
    version: w.version,
    marketplace: w.source,
    category: normalizeCategory(w.category),
    blurb: w.description,
    source_url: w.source_url,
    // null（不知道）跟 []（不缺）在这里都渲染成「不说话」，但它们不是同一件事 ——
    // 别在这一步把前者折成后者，下游要能分得出（[[empty-is-not-json-null]]）。
    needs: w.needs ?? null,
  };
}

const VALID_CATEGORIES: readonly string[] = ['reach', 'answer', 'owner'];

function isSkillCategory(raw: string): raw is SkillCategory {
  return VALID_CATEGORIES.includes(raw);
}

function normalizeCategory(raw: string): SkillCategory {
  return isSkillCategory(raw) ? raw : 'owner';
}
