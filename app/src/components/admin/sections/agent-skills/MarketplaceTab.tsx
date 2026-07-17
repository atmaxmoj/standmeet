// MarketplaceTab —— search bar + source segmented + 2-col card grid.
// Aggregates github + skillsmp; install button writes a local copy.
//
// Design source: docs/design/project/admin.js (2688-2738).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { MarketplaceCard } from '@/components/admin/sections/agent-skills/MarketplaceCard';
import {
  type Marketplace,
} from '@/lib/admin/agent-skills-types';
import type {
  AgentSkillsHook, SourceFilter,
} from '@/lib/admin/use-agent-skills';
import { useAction } from '@/lib/ui/use-action';

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
      <ManualInstall hook={hook} />
    </div>
  );
}

// ManualInstall —— paste a SKILL.md found/downloaded anywhere and install it
// directly (no marketplace, no network). Backend parses frontmatter + body.
function ManualInstall({ hook }: { hook: AgentSkillsHook }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.manual}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={styles.manualToggle}
        data-testid="marketplace-manual-toggle"
        aria-expanded={open}
      >
        {open ? '− paste a SKILL.md' : '+ paste a SKILL.md'}
      </button>
      {open ? <ManualForm hook={hook} /> : null}
    </div>
  );
}

function ManualForm({ hook }: { hook: AgentSkillsHook }) {
  const run = useAction();
  const t = useTranslations('adminIntegrations.marketplaceTab');
  const [md, setMd] = useState('');
  const [name, setName] = useState('');
  const onInstall = () => {
    void run(() => hook.installManual(md, name), { success: 'Skill installed' })
      .then(() => { setMd(''); setName(''); });
  };
  return (
    <div>
      <p className={styles.manualHint}>
        {t.rich('manualHint', {
          ink: (chunks) => <span className={styles.introInk}>{chunks}</span>,
        })}
      </p>
      <div className={styles.manualForm}>
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          placeholder={'---\nname: my-skill\ndescription: what it does\n---\n\n# Instructions…'}
          className={styles.manualArea}
          data-testid="marketplace-manual-md"
        />
        <div className={styles.manualRow}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name (optional — falls back to frontmatter)"
            className={styles.manualName}
            data-testid="marketplace-manual-name"
          />
          <button
            type="button"
            onClick={onInstall}
            disabled={md.trim() === ''}
            className={styles.manualInstall}
            data-testid="marketplace-manual-install"
          >
            {t('manualInstall')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadMore({ hook }: { hook: AgentSkillsHook }) {
  const t = useTranslations('adminIntegrations.marketplaceTab');
  return hook.hasMoreMarket ? (
    <button
      type="button"
      onClick={hook.loadMoreMarket}
      data-testid="marketplace-load-more"
      className={styles.segmentBtn}
    >
      {t('loadMore')}
    </button>
  ) : null;
}

function Intro() {
  const t = useTranslations('adminIntegrations.marketplaceTab');
  return (
    <p className={styles.intro}>
      {t.rich('intro', {
        ink: (chunks) => <span className={styles.introInk}>{chunks}</span>,
      })}
    </p>
  );
}

function SearchBar({ hook }: { hook: AgentSkillsHook }) {
  const t = useTranslations('adminIntegrations.marketplaceTab');
  return (
    <div className={styles.searchRow}>
      <div className={styles.search}>
        <span className={styles.searchIcon}>{t('searchIcon')}</span>
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
  // install 现在抛错 → useAction 收尾（成功 toast / 失败 report），装败不再只清 spinner 假装没事。
  const run = useAction();
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
          onInstall={() => { void run(() => hook.install(m), { success: 'Skill installed' }); }}
          connected={connected}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  const t = useTranslations('adminIntegrations.marketplaceTab');
  return (
    <p className={styles.empty} data-testid="marketplace-empty">
      {t('empty')}
    </p>
  );
}

export type { Marketplace };
