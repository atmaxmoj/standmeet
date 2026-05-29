// InstalledCard —— a single agent-skill card in the my-skills tab.
// Shows name + gate chip + marketplace badge (if installed from market)
// + on/off pill + blurb + connector chips (red when missing) + runs / 30d.
//
// Design source: docs/design/project/admin.js (2762-2804).

'use client';

import {
  SKILL_KIND_LABEL,
  type AgentSkillView,
} from '@/lib/admin/agent-skills-mock';

import styles from '@/components/admin/sections/agent-skills/InstalledCard.module.css';

interface Props {
  skill: AgentSkillView;
  onToggle: () => void;
  connected: readonly string[];
}

export function InstalledCard({ skill, onToggle, connected }: Props) {
  const st = deriveCardState(skill, connected);
  return (
    <article
      className={skill.on ? styles.card : styles.cardDim}
      data-testid={`installed-skill-${skill.id}`}
    >
      <CardHead skill={skill} onToggle={onToggle} blocked={st.blocked} />
      <p className={styles.blurb}>{skill.blurb}</p>
      <CardFoot skill={skill} missing={st.missing} />
      {st.blocked ? <BlockedHint missing={st.missing} /> : null}
    </article>
  );
}

function deriveCardState(
  skill: AgentSkillView, connected: readonly string[],
): { missing: readonly string[]; blocked: boolean } {
  const missing = skill.needs.filter((n) => !connected.includes(n));
  return { missing, blocked: missing.length > 0 && !skill.on };
}

function CardHead({
  skill, onToggle, blocked,
}: { skill: AgentSkillView; onToggle: () => void; blocked: boolean }) {
  return (
    <header className={styles.head}>
      <div className={styles.titleRow}>
        <h4 className={styles.name}>{skill.name}</h4>
        <span className={skill.gate === 'owner' ? styles.gateOwner : styles.gateAuto}>
          {SKILL_KIND_LABEL[skill.gate]}
        </span>
        {skill.marketplace ? <MarketBadge marketplace={skill.marketplace} /> : null}
      </div>
      <ToggleBtn on={skill.on} blocked={blocked} onToggle={onToggle} />
    </header>
  );
}

function MarketBadge({ marketplace }: { marketplace: string }) {
  return <span className={styles.mpBadge}>· {marketplace}</span>;
}

function ToggleBtn({
  on, blocked, onToggle,
}: { on: boolean; blocked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={blocked}
      className={on ? styles.toggleOn : styles.toggleOff}
      data-testid="toggle"
    >
      {on ? '● on' : '○ off'}
    </button>
  );
}

function CardFoot({
  skill, missing,
}: { skill: AgentSkillView; missing: readonly string[] }) {
  return (
    <footer className={styles.foot}>
      <div className={styles.meta}>
        <span className={styles.id}>id · {skill.id}</span>
        {skill.needs.map((n) => (
          <span
            key={n}
            className={missing.includes(n) ? styles.needMissing : styles.need}
          >
            {missing.includes(n) ? `✕ needs ${n}` : `· ${n}`}
          </span>
        ))}
      </div>
      <span className={styles.runs}>{skill.runs_30d} runs / 30d</span>
    </footer>
  );
}

function BlockedHint({ missing }: { missing: readonly string[] }) {
  return (
    <div className={styles.blockedHint}>
      connect {missing.join(' + ')} to enable
    </div>
  );
}
