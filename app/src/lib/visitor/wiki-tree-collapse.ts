// wiki-tree-collapse —— WikiTreeView 折叠态的纯逻辑(组件层禁 if,放 lib)。
// collapsed = 一组「合上」的 folder id。默认全合,除了当前条的祖先链(自动展开
// 到当前)。toggle 单个、toggle-all 全开/全合。

import type { WikiTreeFullNode } from '@/lib/api/public';

// folderIds —— 所有有子节点的 id(可折叠的)。
export function folderIds(nodes: WikiTreeFullNode[]): string[] {
  const out: string[] = [];
  const walk = (n: WikiTreeFullNode): void => {
    if (n.children.length > 0) {
      out.push(n.id);
      n.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return out;
}

// ancestorIdsOf —— activePath 那条到根的 folder id 集 **含当前节点自身**。这样
// 点父节点文章落地后,它自己的子树也是展开的(owner 要求:点父标题就展开子树,
// 不必只点那个小 caret),而不只是展开到它的父链。
export function ancestorIdsOf(nodes: WikiTreeFullNode[], activePath: string): Set<string> {
  const acc = new Set<string>();
  const dfs = (n: WikiTreeFullNode, trail: string[]): boolean => {
    const here = [...trail, n.id];
    if (n.path === activePath) {
      here.forEach((id) => acc.add(id));
      return true;
    }
    return n.children.some((c) => dfs(c, here));
  };
  nodes.forEach((n) => dfs(n, []));
  return acc;
}

// initialCollapsed —— 默认合上所有 folder,但展开当前条的祖先。
export function initialCollapsed(nodes: WikiTreeFullNode[], activePath: string): Set<string> {
  const ancestors = ancestorIdsOf(nodes, activePath);
  return new Set(folderIds(nodes).filter((id) => !ancestors.has(id)));
}

export function toggledSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

// allToggled —— 有任何展开的 → 全合;否则全开。
export function allToggled(prev: Set<string>, nodes: WikiTreeFullNode[]): Set<string> {
  const all = folderIds(nodes);
  const anyOpen = all.some((id) => !prev.has(id));
  return new Set(anyOpen ? all : []);
}
