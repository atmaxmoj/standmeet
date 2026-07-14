// /admin —— 根落地跳 dashboard 总览(returning owner 想先看全局状态,
// 不是直接掉进 public-face 编辑器)。

import { redirect } from 'next/navigation';

export default function AdminIndex() {
  redirect('/admin/dashboard');
}
