import { AdminShell } from '@/components/admin/AdminShell';
import { SkillsSection } from '@/components/admin/sections/SkillsSection';

export default function AdminSkillsPage() {
  return <AdminShell active="skills"><SkillsSection /></AdminShell>;
}
