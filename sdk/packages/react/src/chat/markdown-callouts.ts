// markdown-callouts.ts — remark transform for Obsidian callouts (`> [!type] Title` / body).
//
// DOM matches Obsidian: blockquote → `class="callout" data-callout="<type>"`, with the
// first line's title pulled out into its own `.callout-title` div. This way the owner's
// snippets (e.g. `.callout[data-callout="theorem"]`) hit the same DOM shape on both the
// vault side and the StandMeet side. Hand-written walk (no unist-util-visit import).

// First-line marker: `[!type]` + optional fold marker (+/-) + optional title.
const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)/;

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

// remarkCallouts — turns a blockquote that starts with `[!type]` into a callout container.
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
  // Strip the marker line (plus the newline right after it) out of the body text.
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
