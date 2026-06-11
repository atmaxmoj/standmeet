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
// Pass-1 ships with mock data — see use-agent-skills.ts. Pass-2 swaps
// the hook's inner store for REST fetches without touching this layer.

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
