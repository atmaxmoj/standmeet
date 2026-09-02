// SkillsTabs — the tab bar for /admin/skills: my skills (this registry's CRUD list) ·
// marketplace (search + install). Extracted from the pre-merge AgentSkillsSection.TabsBar
// (skill registry has only one entry point, see SkillsSection header comment / rot-D1).
// testid uses `skills-tab-*` (the agent-skills set retires along with the merge).

'use client';

import styles from '@/components/admin/sections/AgentSkillsSection.module.css';

export type SkillsTab = 'installed' | 'marketplace';

const TAB_LABEL: Record<SkillsTab, string> = {
  installed: 'my skills',
  marketplace: 'marketplace',
};

export function SkillsTabs({ tab, setTab }: { tab: SkillsTab; setTab: (t: SkillsTab) => void }) {
  return (
    <div className={styles['tabs']}>
      <TabBtn id="installed" tab={tab} setTab={setTab} />
      <TabBtn id="marketplace" tab={tab} setTab={setTab} />
    </div>
  );
}

function TabBtn({
  id, tab, setTab,
}: { id: SkillsTab; tab: SkillsTab; setTab: (t: SkillsTab) => void }) {
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={tab === id ? styles['tabBtnActive'] : styles['tabBtn']}
      data-testid={`skills-tab-${id}`}
    >
      {TAB_LABEL[id]}
    </button>
  );
}
