// /admin/agent-skills —— 老门，重定向到合并后的 /admin/skills（skill registry 只有一个门，rot-D1）。
import { redirect } from 'next/navigation';

export default function AdminAgentSkillsPage() {
  redirect('/admin/skills');
}
