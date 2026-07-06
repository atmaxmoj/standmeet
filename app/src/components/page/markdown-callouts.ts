// markdown-callouts.ts —— Obsidian callout(`> [!type] Title` / body)的 remark transform。
//
// DOM 对齐 Obsidian:blockquote → `class="callout" data-callout="<type>"`,首行标题
// 单拎成 `.callout-title` div。这样 owner 的 snippet(`.callout[data-callout="theorem"]`
// 之类)在 vault 和 StandMeet 两侧命中同一 DOM。手写 walk(不引 unist-util-visit)。

// 首行 marker:`[!type]` + 可选 fold 记号(+/-) + 可选标题。
const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)/;

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

// remarkCallouts —— 把 `[!type]` 开头的 blockquote 变成 callout 容器。
export function remarkCallouts() {
  return (tree: MdNode): void => walk(tree);
}

function walk(node: MdNode): void {
  if (!node.children) {
    return;
  }
  for (const child of node.children) {
    if (child.type === 'blockquote') {
      transformCallout(child);
    }
    walk(child);
  }
}

function transformCallout(node: MdNode): void {
  const firstPara = node.children?.[0];
  const firstText = firstPara?.children?.[0];
  if (!firstPara || firstText?.type !== 'text' || firstText.value === undefined) {
    return;
  }
  const m = CALLOUT_RE.exec(firstText.value);
  if (!m) {
    return;
  }
  const type = m[1]!.toLowerCase();
  const title = m[3]!.trim() || capitalize(m[1]!);
  // 从正文里剥掉 marker 行(含随后的换行)。
  firstText.value = firstText.value.slice(m[0].length).replace(/^\n/, '');
  node.data = { hProperties: { className: 'callout', 'data-callout': type } };
  node.children!.unshift({
    type: 'paragraph',
    data: { hName: 'div', hProperties: { className: 'callout-title' } },
    children: [{ type: 'text', value: title }],
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
