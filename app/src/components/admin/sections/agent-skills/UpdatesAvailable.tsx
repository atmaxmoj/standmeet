// UpdatesAvailable —— sits above the installed grid; one row per skill
// whose installed_version differs from latest_version. Marketplace-installed
// skills only; built-ins skip this banner entirely.
//
// Design source: docs/design/project/admin.js (2741-2752).

'use client';

import type { AgentSkillView } from '@/lib/admin/agent-skills-mock';

import styles from '@/components/admin/sections/agent-skills/UpdatesAvailable.module.css';

export function UpdatesAvailable({ updates }: { updates: readonly AgentSkillView[] }) {
  return updates.length === 0 ? null : (
    <aside
      className={styles.card}
      data-testid="updates-available"
      aria-label="updates available"
    >
      <header className={styles.label}>updates available</header>
      <div className={styles.list}>
        {updates.map((s) => (
          <UpdateRow key={s.id} skill={s} />
        ))}
      </div>
    </aside>
  );
}

function UpdateRow({ skill }: { skill: AgentSkillView }) {
  return (
    <div className={styles.row}>
      <span className={styles.name}>
        {skill.name}{' '}
        <span className={styles.versions}>
          {skill.installed_version} → {skill.latest_version}
        </span>
      </span>
      <button
        type="button"
        className={styles.update}
        data-testid={`update-skill-${skill.id}`}
      >
        update
      </button>
    </div>
  );
}
