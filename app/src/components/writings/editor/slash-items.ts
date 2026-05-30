// slash-items.ts —— slash menu 单点注册表。加新 block type 改这一处。
//
// 设计点：每条 item 自己知道怎么把自己插进编辑器（insert 接 Editor 实例
// 调 chain）。SlashMenu 只渲染 + 转发键盘，不知道 block 类型。这就是
// "真单点 registry" —— renderer/parser/menu 没有耦合。

import type { Editor } from '@tiptap/core';

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  // 触发关键词（fuzzy match 拿来过滤）。第一个一般跟 title 一致。
  keywords: string[];
  // hint 是右侧 kbd 提示（例如 "##" 提示这等同于 ## markdown shortcut）。
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

// filterItems —— fuzzy match by query. 没 query 返全集。
export function filterItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  return q === ''
    ? slashItems
    : slashItems.filter((it) =>
        it.title.toLowerCase().includes(q) ||
        it.keywords.some((k) => k.toLowerCase().includes(q)));
}
