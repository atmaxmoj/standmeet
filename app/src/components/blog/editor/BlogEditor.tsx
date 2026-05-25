// BlogEditor —— admin /posts 用的 Tiptap 编辑器。
//
// 单一数据形态：markdown。value 进 markdown，onChange 出 markdown，跟
// 后端 body_md 一一对应。Tiptap 内部是 ProseMirror doc，靠 tiptap-markdown
// 双向序列化。
//
// 关键 extensions：
//   StarterKit (paragraph/heading/list/quote/code/marks + 自带 markdown
//   shortcut input rules - 边打 `## ` 边变 h2、`**bold**` 边打边粗体)
//   Link / Typography / Placeholder
//   Markdown (tiptap-markdown，serialize/parse)
//   SlashCommand (我们自己的，按 / 弹 menu)
//
// BubbleToolbar 跟 editor 同位渲染，选区出现工具条。
//
// 注：这是 client component (Tiptap 用 DOM API)。

'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Typography from '@tiptap/extension-typography';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import type { Editor as TiptapEditor } from '@tiptap/core';

import { SlashCommand } from '@/components/blog/editor/extensions/slash-command';
import { BubbleToolbar } from '@/components/blog/editor/ui/BubbleToolbar';

interface Props {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
}

// tiptap-markdown 在 editor.storage.markdown 挂 getMarkdown()；包一层强类型
// 避免 unsafe-call lint。
interface MarkdownStorage { getMarkdown(): string }

export function BlogEditor({ value, onChange, placeholder }: Props) {
  const editor = useEditor({
    extensions: buildExtensions(placeholder),
    content: value,
    immediatelyRender: false, // Next SSR 安全
    onUpdate: ({ editor: ed }) => emitMarkdown(ed, onChange),
    editorProps: {
      attributes: {
        class: 'blog-editor-surface min-h-[300px] outline-none',
        'data-testid': 'post-field-body',
      },
    },
  });

  return (
    <div className="relative border border-(--color-rule) bg-(--color-paper) px-3 py-2">
      <EditorContent editor={editor} />
      <BubbleToolbar editor={editor} />
    </div>
  );
}

function buildExtensions(placeholder?: string) {
  return [
    StarterKit.configure({}),
    Link.configure({ openOnClick: false, autolink: true }),
    Typography,
    Placeholder.configure({
      placeholder: placeholder ?? "Write… type '/' for blocks.",
    }),
    Markdown.configure({ html: false, tightLists: true, breaks: false }),
    SlashCommand,
  ];
}

function emitMarkdown(ed: TiptapEditor, onChange: (md: string) => void): void {
  const storage = (ed.storage as unknown as Record<string, unknown>)['markdown'] as
    MarkdownStorage | undefined;
  const md = storage?.getMarkdown();
  typeof md === 'string' && onChange(md);
}
