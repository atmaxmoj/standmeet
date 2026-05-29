// MySkillsTab —— "my skills" tab body. Renders an "updates available"
// crosshair card (when any installed skill's installed_version diverges
// from latest_version) plus three category groups of InstalledCard.
//
// Design source: docs/design/project/admin.js AgentSkillsSection
// (2740-2807, my-skills branch).

'use client';

import { InstalledCard } from '@/components/admin/sections/agent-skills/InstalledCard';
import { UpdatesAvailable } from '@/components/admin/sections/agent-skills/UpdatesAvailable';
import {
  CATEGORY_LABEL, type AgentSkillView, type SkillCategory,
} from '@/lib/admin/agent-skills-mock';
import type { AgentSkillsHook } from '@/lib/admin/use-agent-skills';

import styles from '@/components/admin/sections/agent-skills/MySkillsTab.module.css';

const CATEGORIES: readonly SkillCategory[] = ['reach', 'answer', 'owner'];

export function MySkillsTab({
  hook, connected,
}: { hook: AgentSkillsHook; connected: readonly string[] }) {
  const groups = CATEGORIES.map((cat) => ({
    cat,
    items: hook.installed.filter((s) => s.cat === cat),
  })).filter((g) => g.items.length > 0);
  return (
    <div>
      <UpdatesAvailable updates={hook.updates} />
      {groups.map((g) => (
        <CategoryGroup
          key={g.cat} cat={g.cat} items={g.items}
          toggle={hook.toggle} connected={connected}
        />
      ))}
    </div>
  );
}

function CategoryGroup({
  cat, items, toggle, connected,
}: {
  cat: SkillCategory;
  items: readonly AgentSkillView[];
  toggle: (id: string) => void;
  connected: readonly string[];
}) {
  const on = items.filter((s) => s.on).length;
  return (
    <div className={styles.group}>
      <header className={styles.groupHeader}>
        <span className={styles.groupTitle}>{CATEGORY_LABEL[cat]}</span>
        <span className={styles.groupCount}>{on} / {items.length} on</span>
      </header>
      <div className={styles.grid}>
        {items.map((s) => (
          <InstalledCard key={s.id} skill={s} onToggle={() => toggle(s.id)} connected={connected} />
        ))}
      </div>
    </div>
  );
}
