// MarketplaceTab —— search bar + source segmented + 2-col card grid.
// Aggregates github + skillsmp; install button writes a local copy.
//
// Design source: docs/design/project/admin.js (2688-2738).

'use client';

import { MarketplaceCard } from '@/components/admin/sections/agent-skills/MarketplaceCard';
import {
  type Marketplace,
} from '@/lib/admin/agent-skills-types';
import type {
  AgentSkillsHook, SourceFilter,
} from '@/lib/admin/use-agent-skills';

import styles from '@/components/admin/sections/agent-skills/MarketplaceTab.module.css';

const SOURCES: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: 'all',      label: 'all' },
  { value: 'github',   label: 'github' },
  { value: 'skillsmp', label: 'skillsmp' },
];

export function MarketplaceTab({
  hook, connected,
}: { hook: AgentSkillsHook; connected: readonly string[] }) {
  return (
    <div>
      <Intro />
      <SearchBar hook={hook} />
      <ResultsGrid hook={hook} connected={connected} />
      <LoadMore hook={hook} />
    </div>
  );
}

function LoadMore({ hook }: { hook: AgentSkillsHook }) {
  return hook.hasMoreMarket ? (
    <button
      type="button"
      onClick={hook.loadMoreMarket}
      data-testid="marketplace-load-more"
      className={styles.segmentBtn}
    >
      load more
    </button>
  ) : null;
}

function Intro() {
  return (
    <p className={styles.intro}>
      Skills aggregate from two sources — the open{' '}
      <span className={styles.introInk}>anthropics/skills</span> GitHub repo
      (anyone can fork + PR) and{' '}
      <span className={styles.introInk}>SkillsMP</span> (commercial channel).
      Installing fetches the skill’s SKILL.md, parses its frontmatter, and writes
      a local copy you fully own — edit the prompt or allowed-tools after,
      decoupled from the marketplace.
    </p>
  );
}

function SearchBar({ hook }: { hook: AgentSkillsHook }) {
  return (
    <div className={styles.searchRow}>
      <div className={styles.search}>
        <span className={styles.searchIcon}>⌕</span>
        <input
          value={hook.query}
          onChange={(e) => hook.setQuery(e.target.value)}
          placeholder="search skills…"
          className={styles.searchInput}
          data-testid="marketplace-search"
        />
      </div>
      <SourceSegmented value={hook.source} onChange={hook.setSource} />
    </div>
  );
}

function SourceSegmented({
  value, onChange,
}: { value: SourceFilter; onChange: (v: SourceFilter) => void }) {
  return (
    <div className={styles.segmented} role="tablist" aria-label="marketplace source">
      {SOURCES.map((s) => (
        <SourceSegmentBtn
          key={s.value}
          option={s}
          active={value === s.value}
          onClick={() => onChange(s.value)}
        />
      ))}
    </div>
  );
}

function SourceSegmentBtn({
  option, active, onClick,
}: {
  option: { value: SourceFilter; label: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? styles.segmentBtnActive : styles.segmentBtn}
      data-testid={`marketplace-source-${option.value}`}
    >
      {option.label}
    </button>
  );
}

function ResultsGrid({
  hook, connected,
}: { hook: AgentSkillsHook; connected: readonly string[] }) {
  return hook.marketResults.length === 0 ? (
    <EmptyState />
  ) : (
    <div className={styles.grid} data-testid="marketplace-grid">
      {hook.marketResults.map((m) => (
        <MarketplaceCard
          key={m.id}
          skill={m}
          installed={hook.installedNames.has(m.name)}
          installing={hook.installing === m.id}
          onInstall={() => hook.install(m)}
          connected={connected}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <p className={styles.empty} data-testid="marketplace-empty">
      No skills match. Try a different term, or switch source — the GitHub repo
      and SkillsMP are queried in parallel.
    </p>
  );
}

export type { Marketplace };
