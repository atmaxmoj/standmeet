// WritingEditor —— the Tiptap editor used by admin /writings.
//
// Single data shape: markdown. value is body_md (containing
// standmeet-asset:<id> URI references, where <id> may be a real UUID
// (already stored) or pending-<uuid> (newly pasted image within this
// session)). onChange emits markdown in the same shape. When the owner
// clicks save, WritingForm pulls the pending files out via onPendingFiles
// and multipart POST/PATCHes them together with body_md + cover.
//
// Display: the image node's src inside the editor is in URI shape, which
// the browser can't render on its own. expandURIsToURLs(body, urlMap)
// converts it to https for Tiptap to see (urlMap contains the presigned
// URL of already-stored assets + the blob URL of pending uploads).
// On onUpdate, contractURLsToURIs converts it back to URI shape before
// sending it to onChange.

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

import { CrosslinkCommand } from '@/components/writings/editor/extensions/crosslink-command';
import { SlashCommand } from '@/components/writings/editor/extensions/slash-command';
import { ImageUpload } from '@/components/writings/editor/extensions/image-upload';
import { BubbleToolbar } from '@/components/writings/editor/ui/BubbleToolbar';
import {
  expandURIsToURLs, contractURLsToURIs, invertMap,
} from '@/lib/writings/asset-transforms';
import type { PendingFile } from '@/lib/writings/upload-asset';

interface Props {
  value: string;
  onChange: (md: string) => void;
  // assetURLs —— server-provided presigned URL map for already-stored
  // assets (writing.asset_urls when editing); newly pasted pending images
  // are tracked separately via onPending.
  assetURLs?: Record<string, string>;
  onPending?: (pending: PendingFile) => void;
  placeholder?: string;
}

import { getMarkdownFromEditor } from '@/lib/writings/markdown-storage';

export function WritingEditor({
  value, onChange, placeholder, onPending, assetURLs,
}: Props) {
  // urlMapRef is stable across renders: server-provided real id ->
  // presigned URL, plus pending-id -> blob URL (newly pasted). Used to
  // expand on display; on emit it's inverted then contracted back to URI.
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
        class: 'writing-editor-surface min-h-[300px] outline-none',
        'data-testid': 'writing-field-body',
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
    CrosslinkCommand,
    ImageUpload.configure({ onPending }),
  ];
}

function emitContracted(
  ed: TiptapEditor, urlMap: Record<string, string>,
  onChange: (md: string) => void,
): void {
  const raw = getMarkdownFromEditor(ed.storage);
  typeof raw === 'string' && onChange(contractURLsToURIs(raw, invertMap(urlMap)));
}
