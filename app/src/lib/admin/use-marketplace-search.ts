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
  // repo_stars —— null just means null (this source can't report a star
  // count). `.default(0)` is not allowed: that's exactly the step that
  // printed `★ 0` on every GitHub card — translating "unknown" into "zero stars" (F-F-2).
  repo_stars: z.number().nullish(),
  // needs —— the names of connectors ('calendar' / 'smtp') behind this
  // skill's tools that the owner **hasn't** connected yet.
  //   null / absent = the server couldn't answer (hasn't read its SKILL.md,
  //     or this instance can't parse it) → the card stays silent;
  //   []             = it could answer, nothing missing;
  //   [...]          = missing these.
  // **The set difference is computed server-side**: both halves — "what this
  // skill needs" and "what the owner has connected" — live there; computing
  // it again on the client would mean maintaining its own
  // connector→label lookup table, which is just a third name for the same thing (F-F-4).
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
  // seq —— the most recently sent request wins. Without it, **an earlier
  // request that comes back late would win**: the full catalog from an empty
  // query lands on top of results from a just-run search, while the search
  // box still shows what the owner typed — and nothing errors anywhere
  // (F-F-6). The connector list already handles this (useLatestList); it was missed here.
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
  // A newer request already went out by the time this returns → this one is
  // stale news, drop it. **A failure gets dropped the same way**: an error
  // from a superseded request has nothing to say about the query currently on screen.
  if (ticket !== seq.current) return;
  setState(next);
}

// fetchState —— folds one request's result (success or failure) into a
// State. Kept separate from "should this be adopted" so the "most recent
// wins" rule above has exactly one decision point.
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
    // null (unknown) and [] (nothing missing) both render as "silent" here,
    // but they aren't the same thing — don't fold the former into the latter
    // at this step, downstream must be able to tell them apart ([[empty-is-not-json-null]]).
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
