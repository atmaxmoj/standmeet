// MarketplaceCard —— one card in the marketplace grid. Renders skill
// metadata + install button (or "✓ installed" pill when present in the
// local registry). Missing connector hint in vermillion.
//
// Design source: docs/design/project/admin.js (2711-2733).

'use client';

import type { MarketSkillView } from '@/lib/admin/agent-skills-mock';

import styles from '@/components/admin/sections/agent-skills/MarketplaceCard.module.css';

interface Props {
  skill: MarketSkillView;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
  connected: readonly string[];
}

export function MarketplaceCard({
  skill, installed, installing, onInstall, connected,
}: Props) {
  const missing = skill.needs.filter((n) => !connected.includes(n));
  return (
    <article className={styles.card} data-testid={`market-skill-${skill.id}`}>
      <CardHead skill={skill} />
      <p className={styles.blurb}>{skill.blurb}</p>
      <CardFoot
        skill={skill}
        installed={installed}
        installing={installing}
        onInstall={onInstall}
      />
      {missing.length > 0 && !installed
        ? <MissingHint missing={missing} />
        : null}
    </article>
  );
}

function CardHead({ skill }: { skill: MarketSkillView }) {
  return (
    <header className={styles.head}>
      <div className={styles.titleRow}>
        <h4 className={styles.name}>{skill.name}</h4>
        <span
          className={skill.marketplace === 'github' ? styles.mpGithub : styles.mpSkillsmp}
        >
          {skill.marketplace}
        </span>
      </div>
      <span className={styles.stars}>★ {skill.stars}</span>
    </header>
  );
}

function CardFoot({
  skill, installed, installing, onInstall,
}: { skill: MarketSkillView; installed: boolean; installing: boolean; onInstall: () => void }) {
  return (
    <footer className={styles.foot}>
      <span className={styles.author}>{skill.author} · v{skill.version}</span>
      {installed
        ? <InstalledPill />
        : <InstallBtn installing={installing} onInstall={onInstall} />}
    </footer>
  );
}

function InstalledPill() {
  return <span className={styles.installedPill}>✓ installed</span>;
}

function InstallBtn({
  installing, onInstall,
}: { installing: boolean; onInstall: () => void }) {
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={installing}
      className={styles.installBtn}
      data-testid="install-btn"
    >
      {installing ? 'installing…' : 'install ↓'}
    </button>
  );
}

function MissingHint({ missing }: { missing: readonly string[] }) {
  return (
    <div className={styles.missing}>
      needs {missing.join(' + ')}
    </div>
  );
}
