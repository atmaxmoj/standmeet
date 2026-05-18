// /admin/raw —— owner 通过 MCP push 进来的"原始倾倒"列表（纯展示）。

import { AdminShell } from '@/components/admin/AdminShell';
import { RawList } from '@/components/admin/RawList';

export default function AdminRawPage() {
  return <AdminShell active="raw"><RawList /></AdminShell>;
}
