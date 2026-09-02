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
}

export function MarketplaceCard({
  skill, installed, installing, onInstall,
}: Props) {
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
      <MissingHint missing={hintable(skill, installed)} />
    </article>
  );
}

// hintable —— which connectors this card should mention.
//
// needs is already a **difference set** (computed server-side: connectors the skill
// wants, minus the ones the owner already has). Don't subtract again here — both
// halves of that subtraction live on the server; doing it client-side would mean
// maintaining a second connector lookup table here (F-F-4).
// null (server can't answer) and [] (nothing missing) both mean "say nothing", and
// so does installed: what to connect is a post-install concern by then.
function hintable(skill: MarketSkillView, installed: boolean): readonly string[] {
  return installed ? [] : (skill.needs ?? []);
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
      <RepoStars stars={skill.repoStars} />
    </header>
  );
}

// RepoStars —— counts stars on the skill's **repo**, so the label must say repo:
// sibling skills in the same repo share one number, and without the label a
// column of identical numbers reads as "these skills are equally popular".
// When the source can't report it (null), print nothing — the previous version
// printed `★ 0`, which turned "unknown" into "zero stars" (F-F-2).
function RepoStars({ stars }: { stars: number | null }) {
  const t = useTranslations('adminIntegrations.marketplaceCard');
  return stars === null ? null : (
    <span className={styles.stars} data-testid="market-stars">
      {t('repoStars', { stars: String(stars) })}
    </span>
  );
}

function CardFoot({
  skill, installed, installing, onInstall,
}: { skill: MarketSkillView; installed: boolean; installing: boolean; onInstall: () => void }) {
  const t = useTranslations('adminIntegrations.marketplaceCard');
  return (
    <footer className={styles.foot}>
      {/* market-author, not market-skill-author: `market-skill-` is the **card's**
          namespace (`market-skill-<id>`). If a field inside the card reused that
          prefix, a selector counting cards would count the field too — each card
          would count as two. That's exactly what F-F-2 was once misdiagnosed as
          "duplicate backend results". */}
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

// MissingHint —— renders nothing when empty (the element itself is absent, so a
// guard can assert "no hint shown" from that).
function MissingHint({ missing }: { missing: readonly string[] }) {
  return missing.length === 0 ? null : <MissingHintText missing={missing} />;
}

function MissingHintText({ missing }: { missing: readonly string[] }) {
  const t = useTranslations('adminIntegrations.marketplaceCard');
  return (
    <div className={styles.missing} data-testid="marketplace-needs-hint">
      {t('needs', { missing: missing.join(' + ') })}
    </div>
  );
}
