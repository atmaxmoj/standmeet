// tree-open-store —— 语料树里**哪些节点是展开的**。
//
// 为什么这件事不能住在组件里：`NodeItem` 原本用 `useState` 记自己开没开，而换一篇文章
// 是一次导航 —— 整棵树连同每个 `NodeItem` 一起重挂，`useState` 的初值重新读一遍
// `openPaths`（也就是"只展开到当前这一条"），读者手动展开的那几支全部塌回去，
// 每一层还要重新拉一次。屏幕上的样子就是「切文章的时候树重新加载了」。
//
// 展开状态是**这一次浏览的状态**，不是某个组件的状态：它要活得比任何一次挂载久。
// 所以它住在 store 里，跟会话、ghost、能力那几份一样（[[mail-state-single-zustand]] 同源：
// 一份状态一个家，别在每个使用点各存一份）。
//
// 只在内存里，不落 storage：它是"这一趟读到哪儿"的痕迹，不是要跨天恢复的偏好。

import { create } from 'zustand';

interface TreeOpenState {
  // open —— 展开着的节点 path。用 path 不用 id：SSR 那一份和带 token 重取的那一份
  // 是两批对象，id 在两批之间不保证是同一个，而 path 是同一个东西的同一个名字。
  readonly open: ReadonlySet<string>;
  toggle: (path: string) => void;
  // ensureOpen —— 自动展开到当前这一条（reader 进来时用）。已经开着的不动，
  // 所以它不会把读者手动收起来的那一支再掰开。
  ensureOpen: (paths: readonly string[]) => void;
}

export const useTreeOpenStore = create<TreeOpenState>((set) => ({
  open: new Set<string>(),
  toggle: (path) => set((s) => {
    const next = new Set(s.open);
    // 有就删、没有就加 —— 一次调用同时是"展开"和"收起"，调用方不需要先问状态。
    next.has(path) ? next.delete(path) : next.add(path);
    return { open: next };
  }),
  ensureOpen: (paths) => set((s) => {
    const missing = paths.filter((p) => !s.open.has(p));
    // 一个都不缺就**返回原来那个 Set**：新建一个内容相同的 Set 会让每个订阅者重渲，
    // 而什么都没变（[[copied-invalidation-goes-stale]] 的同源：无意义的失效也是失效）。
    return missing.length === 0 ? s : { open: new Set([...s.open, ...missing]) };
  }),
}));
