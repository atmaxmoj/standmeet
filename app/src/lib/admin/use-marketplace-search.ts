// use-marketplace-search —— /api/admin/marketplace/search fetcher with
// (query, source) state + pagination (#48-4). The backend pages the aggregated
// GitHub + SkillsMP results; loadMore appends the next page.
//
// Backend returns []domain.MarketSkill — we adapt to the frontend
// MarketSkillView shape (camelCase fields, design-aligned).

import { useCallback, useEffect, useState } from 'react';

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
  stars: z.number(),
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
  useEffect(() => {
    void loadPage(query, source, 0, [], setState);
  }, [query, source]);
  const loadMore = useCallback(() => {
    if (state.loading || !state.hasMore) return;
    void loadPage(query, source, state.results.length, state.results, setState);
  }, [query, source, state.loading, state.hasMore, state.results]);
  return { ...state, loadMore };
}

async function loadPage(
  query: string, source: SourceParam, offset: number,
  prev: readonly MarketSkillView[], setState: (s: State) => void,
): Promise<void> {
  setState({ results: prev, loading: true, error: null, hasMore: false });
  try {
    const wire = await fetchMarket(query, source, offset);
    const page = wire.map(adapt);
    setState({
      results: offset === 0 ? page : [...prev, ...page],
      loading: false, error: null, hasMore: wire.length >= PAGE_LIMIT,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'marketplace search failed';
    setState({ results: prev, loading: false, error: msg, hasMore: false });
  }
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
    stars: w.stars,
    version: w.version,
    marketplace: w.source,
    category: normalizeCategory(w.category),
    blurb: w.description,
    source_url: w.source_url,
    needs: [],
  };
}

const VALID_CATEGORIES: readonly string[] = ['reach', 'answer', 'owner'];

function isSkillCategory(raw: string): raw is SkillCategory {
  return VALID_CATEGORIES.includes(raw);
}

function normalizeCategory(raw: string): SkillCategory {
  return isSkillCategory(raw) ? raw : 'owner';
}
