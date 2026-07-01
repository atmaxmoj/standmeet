// use-agent-skills —— client state for the AgentSkillsSection, backed by the
// REAL skills + marketplace endpoints (#48-5; the Pass-1 mock is gone).
//
//   installed — the owner's real skills (use-skills), with the real
//     enable/disable toggle.
//   marketplace — real search; install fetches + parses the SKILL.md server
//     side (POST /marketplace/install) and the new skill lands in `installed`.

import { useCallback, useMemo, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';
import {
  SkillViewSchema, useSkills, type SkillView,
} from '@/lib/admin/use-skills';
import {
  useMarketplaceSearch, type SourceParam,
} from '@/lib/admin/use-marketplace-search';
import type { MarketSkillView } from '@/lib/admin/agent-skills-types';
import type { ResourceStatus } from '@/lib/state/status';

export type SourceFilter = SourceParam;

export interface AgentSkillView {
  id: string;
  name: string;
  source: string;
  description: string;
  on: boolean;
  isBuiltin: boolean;
}

export interface AgentSkillsHook {
  installed: readonly AgentSkillView[];
  installedStatus: ResourceStatus;
  toggle: (id: string, on: boolean) => void;
  onCount: number;
  marketResults: readonly MarketSkillView[];
  loadMoreMarket: () => void;
  hasMoreMarket: boolean;
  installedNames: ReadonlySet<string>;
  installing: string | null;
  install: (m: MarketSkillView) => Promise<void>;
  query: string;
  setQuery: (q: string) => void;
  source: SourceFilter;
  setSource: (s: SourceFilter) => void;
  /** bumped when an install completes — caller flips the tab back. */
  lastInstalledAt: number;
}

export function useAgentSkills(): AgentSkillsHook {
  const skills = useSkills();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [installing, setInstalling] = useState<string | null>(null);
  const [lastInstalledAt, setLastInstalledAt] = useState(0);
  const search = useMarketplaceSearch(query, source);

  const installed = useMemo(() => skills.skills.map(toAgentSkillView), [skills.skills]);
  const installedNames = useMemo(() => new Set(installed.map((s) => s.name)), [installed]);
  const onCount = useMemo(() => installed.filter((s) => s.on).length, [installed]);

  const toggle = useCallback((id: string, on: boolean) => {
    void skills.toggleSkill(id, on);
  }, [skills]);

  const install = useCallback((m: MarketSkillView) => {
    return runInstall(m, skills.refresh, setInstalling, setLastInstalledAt);
  }, [skills]);

  return {
    installed, installedStatus: skills.status, toggle, onCount,
    marketResults: search.results, loadMoreMarket: search.loadMore,
    hasMoreMarket: search.hasMore, installedNames, installing, install,
    query, setQuery, source, setSource, lastInstalledAt,
  };
}

function toAgentSkillView(s: SkillView): AgentSkillView {
  return {
    id: s.id, name: s.name, source: s.source,
    description: s.description, on: s.enabled, isBuiltin: s.is_builtin,
  };
}

async function runInstall(
  m: MarketSkillView,
  refresh: () => Promise<void>,
  setInstalling: (id: string | null) => void,
  setLastInstalledAt: (t: number) => void,
): Promise<void> {
  setInstalling(m.id);
  try {
    // 抛错（不再吞成 false）：调用方用 useAction 收尾 —— 安装失败不再只是清 spinner 假装没事。
    await installFromMarket(m);
    await refresh();
    setLastInstalledAt(Date.now());
  } finally {
    setInstalling(null);
  }
}

async function installFromMarket(m: MarketSkillView): Promise<void> {
  await adminAPI.post('/marketplace/install', {
    source: m.marketplace, id: m.id, name: m.name, version: m.version,
  }, SkillViewSchema);
}
