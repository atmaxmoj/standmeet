// markdown-vault-links.ts — strips the vault's `[[wikilink]]` syntax out of **the prose
// meant for humans to read**.
//
// The corpus syncs from Obsidian, so the body text is full of `[[note]]` /
// `[[path/to/note|alias]]`. The model writes in the corpus's own voice, so visitor
// answers end up with raw bracketed slugs: not clickable, and self-explanatory to no one
// (F-R-7, `[[pc-well-founded-recursion]]` was seen for real in prod).
//
// **Why not render it as a link**: this slot may be a public / BYOAI session, and the
// visitor may not have access to the note `[[safe-recursion-theorem]]` points to —
// rendering it as a link just builds an entry point that 404s or gets denied on click,
// worse than plain brackets. The real citation mechanism is the `REFERENCES` line under
// the answer, which is scoped to what's readable in this session.
//
// **Left untouched inside code blocks**: that's source code, not prose. In mdast, a fence
// is `code` and inline code is `inlineCode` — neither is a `text` node, so touching only
// `text` naturally skips them, no extra check needed.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

// WIKILINK_RE — matches `[[target]]` / `[[target#heading]]` / `[[target|alias]]`.
// target excludes `]`, `[`, `|`, `#`; alias is captured up to the closing brackets.
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

// stripVaultLinks — keeps the part a human can read: use the alias if one was given,
// otherwise the last segment of the path (`cybernetics/engineering/x` should read as `x`
// in the body text).
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
