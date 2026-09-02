// slash-items.ts —— the single-point registry for the slash menu. Adding
// a new block type means changing only this file.
//
// Design point: each item knows how to insert itself into the editor
// (insert takes the Editor instance and calls chain). SlashMenu only
// renders + forwards keyboard input; it doesn't know about block types.
// That's what makes this a "true single-point registry" —— renderer,
// parser, and menu aren't coupled.

import type { Editor } from '@tiptap/core';

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  // Trigger keywords (used for fuzzy-match filtering). The first one
  // usually matches the title.
  keywords: string[];
  // hint is the kbd hint shown on the right (e.g. "##" hints that this
  // is equivalent to the ## markdown shortcut).
  hint: string;
  insert: (editor: Editor, range: { from: number; to: number }) => void;
}

export const slashItems: SlashItem[] = [
  {
    id: 'h1', title: 'Heading 1', description: 'Top-level title.',
    keywords: ['heading', 'h1', 'title'], hint: '#',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2', title: 'Heading 2', description: 'Section heading.',
    keywords: ['heading', 'h2', 'section'], hint: '##',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3', title: 'Heading 3', description: 'Subsection.',
    keywords: ['heading', 'h3', 'sub'], hint: '###',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'p', title: 'Paragraph', description: 'Plain body text.',
    keywords: ['paragraph', 'text', 'body'], hint: '',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('paragraph').run(),
  },
  {
    id: 'ul', title: 'Bullet list', description: 'Unordered list.',
    keywords: ['list', 'bullet', 'unordered'], hint: '-',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ol', title: 'Numbered list', description: 'Ordered list.',
    keywords: ['list', 'numbered', 'ordered'], hint: '1.',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'quote', title: 'Blockquote', description: 'Pulled quote.',
    keywords: ['quote', 'blockquote', 'pull'], hint: '>',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code', title: 'Code block', description: 'Fenced code with language.',
    keywords: ['code', 'fence', 'block'], hint: '```',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'hr', title: 'Divider', description: 'Horizontal rule.',
    keywords: ['divider', 'rule', 'hr', 'separator'], hint: '---',
    insert: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

// filterItems —— fuzzy match by query. Returns the full set when there's
// no query.
export function filterItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  return q === ''
    ? slashItems
    : slashItems.filter((it) =>
        it.title.toLowerCase().includes(q) ||
        it.keywords.some((k) => k.toLowerCase().includes(q)));
}
