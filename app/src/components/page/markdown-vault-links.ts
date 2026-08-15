// markdown-vault-links.ts —— 把 vault 的 `[[wikilink]]` 写法从**给人读的正文**里去掉。
//
// 语料是从 Obsidian 同步来的，正文里到处是 `[[note]]` / `[[path/to/note|别名]]`。模型照着
// 语料的口吻写，于是访客的答案里出现一串方括号 slug：点不动，也不解释自己是什么（F-R-7，
// prod 上真见过 `[[pc-well-founded-recursion]]`）。
//
// **为什么不渲成链接**：这一格可能是 public / BYOAI 会话，`[[safe-recursion-theorem]]` 指向的
// 笔记访客未必读得到 —— 渲成链接就是造一个点进去被拒或 404 的入口，比方括号更糟。真正的引用
// 装置是答案底下那条 `REFERENCES`，它按这一场的可读范围给。
//
// **代码块里不动**：那是源码不是正文。mdast 里 fence 是 `code`、行内是 `inlineCode`，都不是
// `text` 节点 —— 只改 `text` 就天然绕开了它们，不需要额外判断。

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

// WIKILINK_RE —— `[[target]]` / `[[target#heading]]` / `[[target|alias]]`。
// target 里不含 `]`、`[`、`|`、`#`；alias 取到闭合方括号为止。
const WIKILINK_RE = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g;

export function remarkVaultLinks() {
  return (tree: MdNode): void => walk(tree);
}

function walk(node: MdNode): void {
  if (node.type === 'text' && node.value !== undefined) {
    node.value = stripVaultLinks(node.value);
  }
  for (const child of node.children ?? []) {
    walk(child);
  }
}

// stripVaultLinks —— 留下人读得懂的那部分：写了别名就用别名，否则用路径的最后一段
// （`cybernetics/engineering/x` 在正文里该念作 `x`）。
export function stripVaultLinks(text: string): string {
  return text.replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
    const shown = (alias ?? '').trim();
    return shown !== '' ? shown : lastSegment(target);
  });
}

function lastSegment(target: string): string {
  const parts = target.trim().split('/');
  return parts[parts.length - 1] ?? target;
}
