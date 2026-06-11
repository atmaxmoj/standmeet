// InstalledCard —— one real installed skill in the my-skills tab: name +
// builtin/source badge + on/off toggle (real enable/disable) + description.
// (#48-5: the design-fiction gate/needs/runs metadata is gone — real skills
// don't carry it.)

'use client';

import type { AgentSkillView } from '@/lib/admin/use-agent-skills';

import styles from '@/components/admin/sections/agent-skills/InstalledCard.module.css';

interface Props {
  skill: AgentSkillView;
  onToggle: (on: boolean) => void;
}

export function InstalledCard({ skill, onToggle }: Props) {
  return (
    <article
      className={skill.on ? styles.card : styles.cardDim}
      data-testid={`installed-skill-${skill.id}`}
    >
      <CardHead skill={skill} onToggle={onToggle} />
      <p className={styles.blurb}>{skill.description}</p>
      <footer className={styles.foot}>
        <span className={styles.id}>source · {skill.source}</span>
      </footer>
    </article>
  );
}

function CardHead({
  skill, onToggle,
}: { skill: AgentSkillView; onToggle: (on: boolean) => void }) {
  return (
    <header className={styles.head}>
      <div className={styles.titleRow}>
        <h4 className={styles.name}>{skill.name}</h4>
        {skill.isBuiltin ? <span className={styles.mpBadge}>· builtin</span> : null}
      </div>
      <ToggleBtn on={skill.on} onToggle={onToggle} />
    </header>
  );
}

function ToggleBtn({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className={on ? styles.toggleOn : styles.toggleOff}
      data-testid="toggle"
    >
      {on ? '● on' : '○ off'}
    </button>
  );
}
