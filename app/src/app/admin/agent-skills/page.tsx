import { AdminShell } from '@/components/admin/AdminShell';
import { AgentSkillsSection } from '@/components/admin/sections/AgentSkillsSection';

export default function AdminAgentSkillsPage() {
  return (
    <AdminShell active="agent-skills">
      <AgentSkillsSection />
    </AdminShell>
  );
}
