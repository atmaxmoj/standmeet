// use-marketplace-search —— /api/admin/marketplace/search fetcher with
// (query, source) state. Replaces the Pass-1 MARKET_FIXTURE for the
// marketplace tab; my-skills tab still owns its own installed-list state.
//
// Backend returns []domain.MarketSkill — we adapt to the frontend
// MarketSkillView shape (camelCase fields, design-aligned).

import { useEffect, useState } from 'react';

import { z } from 'zod';

import type { MarketSkillView, SkillCategory } from '@/lib/admin/agent-skills-mock';
import { safeJson } from '@/lib/api/typed-json';

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
}

const INIT_STATE: State = { results: [], loading: true, error: null };

export function useMarketplaceSearch(query: string, source: SourceParam): State {
  const [state, setState] = useState<State>(INIT_STATE);
  useEffect(() => {
    void load(query, source, setState);
  }, [query, source]);
  return state;
}

async function load(
  query: string, source: SourceParam, setState: (s: State) => void,
): Promise<void> {
  setState({ results: [], loading: true, error: null });
  try {
    const wire = await fetchMarket(query, source);
    setState({ results: wire.map(adapt), loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'marketplace search failed';
    setState({ results: [], loading: false, error: msg });
  }
}

async function fetchMarket(
  query: string, source: SourceParam,
): Promise<readonly MarketSkillWire[]> {
  const url = new URL('/api/admin/marketplace/search', window.location.origin);
  if (query) url.searchParams.set('q', query);
  if (source !== 'all') url.searchParams.set('source', source);
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
