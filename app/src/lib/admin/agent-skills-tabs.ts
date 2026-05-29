// agent-skills-tabs —— tab id enum + labels. Kept in a separate module
// so the eslint "no if in presentation" rule lets the .tsx use the
// label map without inline branching.

export type AgentSkillsTab = 'installed' | 'marketplace';

export const TAB_LABEL: Record<AgentSkillsTab, string> = {
  installed: 'my skills',
  marketplace: 'marketplace',
};
