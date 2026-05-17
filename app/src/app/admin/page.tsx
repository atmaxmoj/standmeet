// /admin —— 根落地直接跳 page editor 这种 DoD 主路径。

import { redirect } from 'next/navigation';

export default function AdminIndex() {
  redirect('/admin/page');
}
