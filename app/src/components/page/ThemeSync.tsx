// ThemeSync —— 把 owner/访客选的明暗**挂到 `<html>` 上**，挂在根布局里，一次。
//
// 为什么是根布局（UX-94）：`use-theme` 本身一直是对的，但**调用它的地方在一个分支里** ——
// `page-shell.tsx` 是 `isChatMode ? <ChatRoom/> : <LongScrollBody/>`，而 `useTheme()` 写在
// `LongScrollBody` 里。于是带码的访客走进聊天面时那个 hook 根本没跑：他在读者页点过 dark，
// 偏好也存着，只是**没有人去读它**。而聊天面正是他待得最久的那一面。
//
// 挂在根上之后，「这一页记得读主题吗」这个问题不再存在 —— 没有哪一页需要记得
// （[[reframes-tasks-into-enforced-invariants]]）。TopBar 上那个开关照旧用同一个 hook 写
// localStorage，两边读的是同一把钥匙。

'use client';

import { useTheme } from '@/lib/page/use-theme';

export function ThemeSync() {
  useTheme();
  return null;
}
