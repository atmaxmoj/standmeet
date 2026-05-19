// /admin/raw —— owner 通过 MCP push 进来的"原始倾倒"列表。

import { AdminShell } from '@/components/admin/AdminShell';
import { RawSection } from '@/components/admin/sections/RawSection';

export default function AdminRawPage() {
  return <AdminShell active="raw"><RawSection /></AdminShell>;
}
