// use-agent-skills —— client state for the AgentSkillsSection.
//
// Mock-only for the Pass-1 ship. Pass-2 swaps the inner stores for
// /api/admin/agent-skills (list + toggle) and /api/admin/marketplace
// (search + install) fetches; the hook signature stays stable.

import { useCallback, useMemo, useState } from 'react';

import {
  BUILT_IN_SKILLS,
  marketSkillToInstalled,
  type AgentSkillView,
  type MarketSkillView,
} from '@/lib/admin/agent-skills-mock';
import {
  useMarketplaceSearch, type SourceParam,
} from '@/lib/admin/use-marketplace-search';

export type SourceFilter = SourceParam;

export interface AgentSkillsHook {
  installed: readonly AgentSkillView[];
  toggle: (id: string) => void;
  onCount: number;
  updates: readonly AgentSkillView[];
  marketResults: readonly MarketSkillView[];
  installedIds: ReadonlySet<string>;
  installing: string | null;
  install: (m: MarketSkillView) => void;
  query: string;
  setQuery: (q: string) => void;
  source: SourceFilter;
  setSource: (s: SourceFilter) => void;
  /** activated when an install completes — caller flips the tab back. */
  lastInstalledAt: number;
}

const INSTALL_DELAY_MS = 900;

export function useAgentSkills(): AgentSkillsHook {
  const [installed, setInstalled] = useState<readonly AgentSkillView[]>(BUILT_IN_SKILLS);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [installing, setInstalling] = useState<string | null>(null);
  const [lastInstalledAt, setLastInstalledAt] = useState<number>(0);

  const search = useMarketplaceSearch(query, source);

  const toggle = useCallback((id: string) => {
    setInstalled((skills) => skills.map((s) => s.id === id ? { ...s, on: !s.on } : s));
  }, []);

  const install = useCallback((m: MarketSkillView) => {
    setInstalling(m.id);
    setTimeout(() => {
      setInstalled((skills) => [...skills, marketSkillToInstalled(m)]);
      setInstalling(null);
      setLastInstalledAt(Date.now());
    }, INSTALL_DELAY_MS);
  }, []);

  const installedIds = useMemo(
    () => new Set(installed.map((s) => s.mpId).filter(isString)),
    [installed],
  );
  const updates = useMemo(() => collectUpdates(installed), [installed]);
  const onCount = useMemo(() => installed.filter((s) => s.on).length, [installed]);

  return {
    installed, toggle, onCount, updates,
    marketResults: search.results, installedIds, installing, install,
    query, setQuery, source, setSource,
    lastInstalledAt,
  };
}

function isString(v: string | undefined): v is string {
  return typeof v === 'string';
}

function collectUpdates(installed: readonly AgentSkillView[]): readonly AgentSkillView[] {
  return installed.filter(hasUpdateAvailable);
}

function hasUpdateAvailable(s: AgentSkillView): boolean {
  if (!s.mpId || !s.installed_version || !s.latest_version) return false;
  return s.installed_version !== s.latest_version;
}
