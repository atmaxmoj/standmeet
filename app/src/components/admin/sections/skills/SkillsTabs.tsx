// SkillsTabs —— /admin/skills 的 tab 条：my skills（这份 registry 的 CRUD 列表）· marketplace
// （搜索 + 安装）。从合并前的 AgentSkillsSection.TabsBar 抽出来（skill registry 只有一个门，
// 见 SkillsSection 头注释 / rot-D1）。testid 用 `skills-tab-*`（agent-skills 那套随合并一起退休）。

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
