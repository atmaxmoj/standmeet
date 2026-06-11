// /gate —— 访客没有 code 或想 BYOAI 的入口（v1 单 owner instance）。
//
// 视觉对齐 docs/design/project/gate.html：
//   - TopBar 带 "private" indicator + dark toggle
//   - Hero: Seal 左 + "This isn't open." 大号 serif headline + code 输入
//   - WhatsBehind: 3 行 01/02/03 解释这页背后是什么
//   - BYOAIPanel: 设计稿那种 provider chip + reveal/hide key
//   - RequestPanel: 折叠的"write a note ↘"，展开后写表单
//
// 业务逻辑（POST /api/v1/sessions / access-requests）走 useGate；这里只装配。
// owner handle 从 /api/v1/instance SSR fetch 拿（仅用于显示，不影响路由）。

import { fetchInstance } from '@/lib/api/instance';

import { GateClient } from '@/app/gate/gate-client';

export default async function GatePage() {
  const instance = await fetchInstance();
  return <GateClient handle={instance.handle} canEmailCodes={instance.can_email_codes} />;
}
