// AdminSectionHead —— 后台「一节」的标题。**`.sm-section-h` 只能从这里出来。**
//
// 为什么要有这个组件：这条约定（12px + 朱红竖条 + 下方细线）被补过三次 ——
// UX-76 给 `api·mcp` 的六个大节、2026-08-16 给 `system` 的沙箱面板，而 `connectors`
// 和 `system` 其余五节至今没有。每次都是「记得补」，于是每次都漏下一页（UX-79）。
//
// **为什么不能用 lint 闸解决**：大节标题和字段名在 DOM 里是同一种形状（都是 mono +
// 小号 + uppercase），旧签名 `tracking-[0.18em]` 在 app/src 里有 127 处、访客侧的标签
// 也在用 —— 按签名扫只会扫出噪声。闸门查得到的是**形状**，而这里的区别是**语义**。
//
// 有了这个组件，签名就变成**类名**：`check-one-section-heading` 只允许 `.sm-section-h`
// 出现在本文件和 sm-atoms.css 里。**约定第一次有了归宿，闸门也第一次成立**
// （[[reframes-tasks-into-enforced-invariants]]：让错误在物理上不可能，而不是写进文档）。

// 形状收了两种真实用法：光一个标题，和「标题 + 同一条线右端的副标题」。
// 后者三处（MCP client / download / servers）以前各自在 `.sm-section-h` 里塞
// `<h3 class="mr-auto">` + 一个手抄样式的 span —— 抄第三遍的时候已经抄岔了
// （servers 那处是 `tracking-normal`，另两处是 `tracking-[0.06em]`）。副标题的样式
// 一并收进来，调用方只给内容。
//
// 标题一律是 `h3`（一节的标题**就是**标题；查过没有 spec 用 `getByRole('heading')`
// 选它们，所以统一不动任何断言）。`className` 只收布局微调（`mb-3` / `grow`），
// 视觉由 `.sm-section-h` 一处定。

import type { ReactNode } from 'react';

const ASIDE_CLASS =
  'mono text-[10.5px] tracking-[0.06em] normal-case text-(--color-faint)';

export function AdminSectionHead(
  { children, aside, className = '' }:
  { children: ReactNode; aside?: ReactNode; className?: string },
) {
  return (
    <div className={`sm-section-h ${className}`}>
      <h3 className="mr-auto">{children}</h3>
      {aside === undefined ? null : <span className={ASIDE_CLASS}>{aside}</span>}
    </div>
  );
}
