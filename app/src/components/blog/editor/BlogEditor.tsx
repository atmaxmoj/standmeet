// BlogEditor —— admin /posts 用的 Tiptap 编辑器。
//
// 单一数据形态：markdown。value 进 markdown（含 standmeet-asset:<id>
// URI），onChange 出 markdown（同 URI 形态）。Tiptap 内部 doc 用 presigned
// URL（浏览器能渲染图片）；URI ↔ URL 通过 expandURIsToURLs / contractURLs
// ToURIs 在 load + emit 边界互转。
//
// 关键 extensions：
//   StarterKit (paragraph/heading/list/quote/code/marks + markdown shortcut
//     input rules)
//   Link / Image / Typography / Placeholder
//   Markdown (tiptap-markdown，serialize/parse)
//   SlashCommand (按 / 弹 menu)
//   ImageUpload (paste/drop → 上传 → 插 img 节点)
//
// 注：client component (Tiptap 用 DOM API)。

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
import type { UploadedAsset } from '@/lib/blog/upload-asset';

interface Props {
  value: string;
  onChange: (md: string) => void;
  // assetURLs —— body_md 里 `standmeet-asset:<id>` 引用的 presigned 解析
  // map（backend response 给的）。editor 内 image node 渲染时查这个 map
  // 拿真 URL；新上传的 image 也合并进来。
  assetURLs?: Record<string, string>;
  onLocalUpload?: (asset: UploadedAsset) => void;
  placeholder?: string;
}

interface MarkdownStorage { getMarkdown(): string }

export function BlogEditor({
  value, onChange, placeholder, onLocalUpload, assetURLs,
}: Props) {
  // urlMapRef 跨渲染 stable：初始 = server 给的 assetURLs，新上传通过
  // imageUpload extension 的 onUploaded 喂进来。
  const urlMapRef = useRef<Record<string, string>>({ ...assetURLs });
  const initialContent = expandURIsToURLs(value, urlMapRef.current);

  const handleUploaded = (asset: UploadedAsset) => {
    urlMapRef.current[asset.id] = asset.url;
    onLocalUpload?.(asset);
  };

  const editor = useEditor({
    extensions: buildExtensions(placeholder, handleUploaded),
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
  placeholder?: string, onUploaded?: (asset: UploadedAsset) => void,
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
    ImageUpload.configure({ onUploaded }),
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
