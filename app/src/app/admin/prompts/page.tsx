import { AdminShell } from '@/components/admin/AdminShell';
import { PromptsSection } from '@/components/admin/sections/PromptsSection';

export default function AdminPromptsPage() {
  return <AdminShell active="prompts"><PromptsSection /></AdminShell>;
}
