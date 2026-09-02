// /admin/agent-skills — old door, redirects to the merged /admin/skills (skill registry has
// only one door, rot-D1).
import { redirect } from 'next/navigation';

export default function AdminAgentSkillsPage() {
  redirect('/admin/skills');
}
