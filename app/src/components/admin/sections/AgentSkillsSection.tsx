// AgentSkillsSection —— /admin/agent-skills · integrations · agent.
//
// Design source: docs/design/project/admin.js AgentSkillsSection
// (2583-2814). Two tabs:
//   MY SKILLS — installed registry (built-in + marketplace-installed),
//               with an "updates available" banner when installed_version
//               diverges from latest_version
//   MARKETPLACE — searchable aggregate of GitHub anthropics/skills +
//               SkillsMP, with install button per card
//
// 这里曾经写着 "Pass-1 ships with mock data"。**那已经不是真的**：#48-5 换上了真 endpoint
// （GET /skills/ + /marketplace/search|install|install-manual），mock 早就没了
// （见 use-agent-skills.ts 第一行）。一条过时的注释比没有注释更糟 —— 它会让下一个人以为这块还没接。
//
// ⚠️ 语义重叠（未解决）：MY SKILLS 读的就是 /admin/skills 那份**同一个 registry**
// （use-agent-skills 的 installed 直接来自 use-skills，marketplace install 后端写的也是
// h.SkillsAdmin.Skills.Skills）。一个概念、一份数据、两个顶层入口、两个几乎同名的侧栏标签
// （`skills` 在 access 组、`agent skills` 在 integrations 组）。owner 得在两个地方管同一批东西，
// 而界面上没有任何线索说它们是同一批。合并成一个 /admin/skills（marketplace 作为它的 tab）是
// 该走的方向 —— 见 docs/rot-sweep.md。

'use client';

import { useEffect, useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { MarketplaceTab } from '@/components/admin/sections/agent-skills/MarketplaceTab';
import { MySkillsTab } from '@/components/admin/sections/agent-skills/MySkillsTab';
import { TAB_LABEL, type AgentSkillsTab } from '@/lib/admin/agent-skills-tabs';
import { useAgentSkills } from '@/lib/admin/use-agent-skills';

import styles from '@/components/admin/sections/AgentSkillsSection.module.css';

const CONNECTED_DEFAULT: readonly string[] = ['Email', 'Calendar'];

export function AgentSkillsSection() {
  const hook = useAgentSkills();
  const [tab, setTab] = useState<AgentSkillsTab>('installed');

  // Auto-switch to "installed" after an install completes so owner sees
  // the new skill land in their registry (design admin.js install() does
  // setTab('installed') after appending).
  useEffect(
    () => autoSwitchAfterInstall(hook.lastInstalledAt, setTab),
    [hook.lastInstalledAt],
  );

  return (
    <>
      <SectionHeader
        kicker="integrations · agent"
        title="agent skills"
        count={`${hook.onCount} / ${hook.installed.length} on`}
        action={<TabsBar tab={tab} setTab={setTab} />}
      />
      <TabBody
        tab={tab}
        hook={hook}
        connected={CONNECTED_DEFAULT}
      />
    </>
  );
}

function TabsBar({
  tab, setTab,
}: { tab: AgentSkillsTab; setTab: (t: AgentSkillsTab) => void }) {
  return (
    <div className={styles.tabs}>
      <TabBtn id="installed" tab={tab} setTab={setTab} />
      <TabBtn id="marketplace" tab={tab} setTab={setTab} />
    </div>
  );
}

function TabBtn({
  id, tab, setTab,
}: { id: AgentSkillsTab; tab: AgentSkillsTab; setTab: (t: AgentSkillsTab) => void }) {
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={tab === id ? styles.tabBtnActive : styles.tabBtn}
      data-testid={`agent-skills-tab-${id}`}
    >
      {TAB_LABEL[id]}
    </button>
  );
}

function autoSwitchAfterInstall(
  lastInstalledAt: number,
  setTab: (t: AgentSkillsTab) => void,
): void {
  lastInstalledAt > 0 && setTab('installed');
}

function TabBody({
  tab, hook, connected,
}: { tab: AgentSkillsTab; hook: ReturnType<typeof useAgentSkills>; connected: readonly string[] }) {
  return tab === 'marketplace'
    ? <MarketplaceTab hook={hook} connected={connected} />
    : <MySkillsTab hook={hook} />;
}
