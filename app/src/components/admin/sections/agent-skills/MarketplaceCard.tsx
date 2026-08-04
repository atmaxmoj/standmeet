// MarketplaceCard —— one card in the marketplace grid. Renders skill
// metadata + install button (or "✓ installed" pill when present in the
// local registry). Missing connector hint in vermillion.
//
// Design source: docs/design/project/admin.js.

'use client';

import { useTranslations } from 'next-intl';

import type { MarketSkillView } from '@/lib/admin/agent-skills-types';

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
  const t = useTranslations('adminIntegrations.marketplaceCard');
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
      <span className={styles.stars}>{t('stars', { stars: String(skill.stars) })}</span>
    </header>
  );
}

function CardFoot({
  skill, installed, installing, onInstall,
}: { skill: MarketSkillView; installed: boolean; installing: boolean; onInstall: () => void }) {
  const t = useTranslations('adminIntegrations.marketplaceCard');
  return (
    <footer className={styles.foot}>
      {/* market-author,不是 market-skill-author:`market-skill-` 是**卡片**的命名空间
          (`market-skill-<id>`),卡片里面的字段再叫这个前缀,数卡片的选择器就会连字段一起数进去
          —— 每张卡片算两个。那正是 F-F-2 当年被记成"后端结果重复"的原因。 */}
      <span className={styles.author} data-testid="market-author">
        {skill.version
          ? t('author', { author: skill.author, version: skill.version })
          : t('authorOnly', { author: skill.author })}
      </span>
      {installed
        ? <InstalledPill />
        : <InstallBtn installing={installing} onInstall={onInstall} />}
    </footer>
  );
}

function InstalledPill() {
  const t = useTranslations('adminIntegrations.marketplaceCard');
  return <span className={styles.installedPill}>{t('installed')}</span>;
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
  const t = useTranslations('adminIntegrations.marketplaceCard');
  return (
    <div className={styles.missing} data-testid="marketplace-needs-hint">
      {t('needs', { missing: missing.join(' + ') })}
    </div>
  );
}
