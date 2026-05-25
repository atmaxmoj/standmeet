// image-upload.ts —— editor 接住 paste/drop image。不立即上传：分配
// client-side `pending-<id>`，把 File 存进 editor storage（caller 从
// BlogEditor 拿出来跟 body_md 一起 multipart 提交）。markdown 里写
// `standmeet-asset:pending-<id>`；显示用 URL.createObjectURL 拿 blob URL。

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { newPendingID, assetURI, type PendingFile } from '@/lib/blog/upload-asset';

export interface ImageUploadOptions {
  onPending?: (pending: PendingFile) => void;
}

export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: 'imageUpload',

  addOptions() {
    return {};
  },

  addProseMirrorPlugins() {
    return [makeImagePastePlugin(this.options)];
  },
});

function makeImagePastePlugin(opts: ImageUploadOptions): Plugin {
  return new Plugin({
    key: new PluginKey('imageUpload'),
    props: {
      handlePaste: (view, event) => handlePaste(view, event, opts),
      handleDrop: (view, event) => handleDrop(view, event, opts),
    },
  });
}

function handlePaste(view: EditorView, event: ClipboardEvent, opts: ImageUploadOptions): boolean {
  const file = firstImageFile(event.clipboardData?.files);
  return file ? (event.preventDefault(), insertPending(view, file, opts), true) : false;
}

function handleDrop(view: EditorView, event: DragEvent, opts: ImageUploadOptions): boolean {
  const file = firstImageFile(event.dataTransfer?.files);
  return file ? (event.preventDefault(), insertPending(view, file, opts), true) : false;
}

function firstImageFile(files: FileList | null | undefined): File | undefined {
  return files && files.length > 0 && files[0]?.type.startsWith('image/')
    ? files[0]
    : undefined;
}

// insertPending —— 不上传，分配 pending-id + 存 File，editor doc 插入
// 一个 src=URI 的 image 节点（blob URL 给当前 session 显示；onPending
// 回调把 PendingFile 喂回 BlogEditor 让 PostForm 在 save 时收集）。
function insertPending(view: EditorView, file: File, opts: ImageUploadOptions): void {
  const id = newPendingID();
  const objectURL = URL.createObjectURL(file);
  const pending: PendingFile = { id, file, objectURL };
  opts.onPending?.(pending);
  insertImageNode(view, file.name, assetURI(id));
}

function insertImageNode(view: EditorView, alt: string, src: string): void {
  const { schema } = view.state;
  const node = schema.nodes['image']?.create({ src, alt });
  if (!node) return;
  view.dispatch(view.state.tr.replaceSelectionWith(node));
}
