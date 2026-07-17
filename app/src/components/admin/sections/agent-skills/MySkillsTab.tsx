// MySkillsTab —— "my skills" tab body: the owner's REAL installed skills
// (#48-5), each with the real enable/disable toggle. The Pass-1 category
// groups / updates banner are gone — real skills carry no such metadata.

'use client';

import { useTranslations } from 'next-intl';

import { InstalledCard } from '@/components/admin/sections/agent-skills/InstalledCard';
import type { AgentSkillsHook } from '@/lib/admin/use-agent-skills';

import styles from '@/components/admin/sections/agent-skills/MySkillsTab.module.css';

export function MySkillsTab({ hook }: { hook: AgentSkillsHook }) {
  return hook.installed.length === 0
    ? <Empty />
    : <SkillGrid hook={hook} />;
}

function SkillGrid({ hook }: { hook: AgentSkillsHook }) {
  return (
    <div className={styles.grid} data-testid="installed-skills-grid">
      {hook.installed.map((s) => (
        <InstalledCard key={s.id} skill={s} onToggle={(on) => hook.toggle(s.id, on)} />
      ))}
    </div>
  );
}

function Empty() {
  const t = useTranslations('adminIntegrations.mySkills');
  return (
    <p className={styles.group} data-testid="installed-skills-empty">
      {t('empty')}
    </p>
  );
}
