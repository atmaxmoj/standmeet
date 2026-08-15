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

// hintable —— 这张卡该说哪几个连接器。
//
// needs 已经是**差集**（服务端算的：这个技能要的连接器减去 owner 连上的）。这里不再自己
// 减一次 —— 减法要的两半都在服务端，客户端要算就得自己养一张连接器对照表（F-F-4）。
// null（服务端答不上来）跟 []（不缺）都是「不说」，装过的也不说：那时该连什么已经是安装
// 之后的事了。
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

// RepoStars —— 数的是技能所在**仓库**的星数,所以标签要说 repo:同一个仓库里的兄弟技能
// 共享一个数,不说清楚的话,一列相同的数字读起来就是"这些技能一样受欢迎"。
// 源报不出来(null)就什么都不印 —— 上一版印 `★ 0`,那是把"不知道"说成"零颗星"(F-F-2)。
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

// MissingHint —— 空就不渲染这一格（连元素都不出现，守卫据此断「它不提示」）。
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
