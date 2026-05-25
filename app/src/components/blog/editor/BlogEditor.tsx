// BlogEditor —— admin /posts 用的 Tiptap 编辑器。
//
// 单一数据形态：markdown。value 是 body_md (含 standmeet-asset:<id> URI
// 引用，<id> 可能是真 UUID（已存）或 pending-<uuid>（本次 session 内新粘
// 的图）)。onChange 出 markdown 同形态。owner 点 save 时 PostForm 通过
// onPendingFiles 取出 pending files，跟 body_md + cover 一起 multipart
// POST/PATCH。
//
// 显示：editor 内 image node 的 src 是 URI 形态，浏览器自己渲染不了。
// 通过 expandURIsToURLs(body, urlMap) 转 https 给 Tiptap 看（urlMap 含
// 已存 assets 的 presigned URL + pending uploads 的 blob URL）。
// onUpdate 时 contractURLsToURIs 再转回 URI 形态送到 onChange。

'use client';

import { useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import type { Editor as TiptapEditor } from '@tiptap/core';

import { SlashCommand } from '@/components/blog/editor/extensions/slash-command';
import { ImageUpload } from '@/components/blog/editor/extensions/image-upload';
import { BubbleToolbar } from '@/components/blog/editor/ui/BubbleToolbar';
import {
  expandURIsToURLs, contractURLsToURIs, invertMap,
} from '@/lib/blog/asset-transforms';
import type { PendingFile } from '@/lib/blog/upload-asset';

interface Props {
  value: string;
  onChange: (md: string) => void;
  // assetURLs —— server-provided 已存 asset 的 presigned URL map（edit 时
  // post.asset_urls）；新粘的 pending image 走 onPending 单独 track。
  assetURLs?: Record<string, string>;
  onPending?: (pending: PendingFile) => void;
  placeholder?: string;
}

interface MarkdownStorage { getMarkdown(): string }

export function BlogEditor({
  value, onChange, placeholder, onPending, assetURLs,
}: Props) {
  // urlMapRef 跨渲染 stable：server-provided 真 id → presigned URL +
  // pending-id → blob URL（新粘的）。display 时 expand 用，emit 时 invert
  // 后 contract 回 URI。
  const urlMapRef = useRef<Record<string, string>>({ ...assetURLs });
  const initialContent = expandURIsToURLs(value, urlMapRef.current);

  const handlePending = (pending: PendingFile) => {
    urlMapRef.current[pending.id] = pending.objectURL;
    onPending?.(pending);
  };

  const editor = useEditor({
    extensions: buildExtensions(placeholder, handlePending),
    content: initialContent,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => emitContracted(ed, urlMapRef.current, onChange),
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

function buildExtensions(
  placeholder?: string, onPending?: (pending: PendingFile) => void,
) {
  return [
    StarterKit.configure({}),
    Link.configure({ openOnClick: false, autolink: true }),
    Image.configure({ inline: false, allowBase64: false }),
    Typography,
    Placeholder.configure({
      placeholder: placeholder ?? "Write… type '/' for blocks. Drag or paste images.",
    }),
    Markdown.configure({ html: false, tightLists: true, breaks: false }),
    SlashCommand,
    ImageUpload.configure({ onPending }),
  ];
}

function emitContracted(
  ed: TiptapEditor, urlMap: Record<string, string>,
  onChange: (md: string) => void,
): void {
  const storage = (ed.storage as unknown as Record<string, unknown>)['markdown'] as
    MarkdownStorage | undefined;
  const raw = storage?.getMarkdown();
  typeof raw === 'string' && onChange(contractURLsToURIs(raw, invertMap(urlMap)));
}
