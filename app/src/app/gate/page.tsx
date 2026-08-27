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
import { fetchWikiTreeStats, fetchWritingsPage } from '@/lib/api/public';

import { GateClient } from '@/app/gate/gate-client';

export default async function GatePage() {
  // 匿名身份取（不带 token）—— 这两个数说的正是「**没有码**的人能读到多少」，
  // 而这一页上的人恰好就是没有码的人。带 token 取到的是别人的视角。
  const [instance, wikiStats, writings] = await Promise.all([
    fetchInstance(), fetchWikiTreeStats(), fetchWritingsPage(),
  ]);
  return (
    <GateClient
      handle={instance.handle}
      canDeliverCodes={instance.can_deliver_codes}
      publicWiki={Math.max(wikiStats.entries - wikiStats.gated, 0)}
      publicWritings={writings.writings.length}
    />
  );
}
