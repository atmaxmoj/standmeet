// image-upload.ts —— editor 接住 paste/drop image 文件 → 上传 → 插
// markdown image 节点。
//
// markdown 里写 `![filename](standmeet-asset:<id>)`；editor 内部缓存
// id→presigned URL（onUploadedAsset 回调暴露给 BlogEditor）方便实时显示，
// 同时 backend response 的 asset_urls 是 source of truth。

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { uploadAsset, type UploadedAsset } from '@/lib/blog/upload-asset';

export interface ImageUploadOptions {
  onUploaded?: (asset: UploadedAsset) => void;
  onError?: (err: Error) => void;
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
  return file ? (event.preventDefault(), uploadAndInsert(view, file, opts), true) : false;
}

function handleDrop(view: EditorView, event: DragEvent, opts: ImageUploadOptions): boolean {
  const file = firstImageFile(event.dataTransfer?.files);
  return file ? (event.preventDefault(), uploadAndInsert(view, file, opts), true) : false;
}

function firstImageFile(files: FileList | null | undefined): File | undefined {
  return files && files.length > 0 && files[0]?.type.startsWith('image/')
    ? files[0]
    : undefined;
}

function uploadAndInsert(view: EditorView, file: File, opts: ImageUploadOptions): void {
  // fire-and-forget async；错误回 opts.onError。
  void doUploadAndInsert(view, file, opts);
}

async function doUploadAndInsert(
  view: EditorView, file: File, opts: ImageUploadOptions,
): Promise<void> {
  try {
    const uploaded = await uploadAsset(file);
    // 顺序关键：先回调把 (id, url) 进 urlMapRef，再 dispatch insert（dispatch
    // 会触发 BlogEditor.onUpdate → contractURLsToURIs(url → URI)）。
    // 反了的话 emit 时 map 还没新条目，body_md 会留 presigned URL。
    opts.onUploaded?.(uploaded);
    insertImageDisplay(view, file.name, uploaded.url);
  } catch (err) {
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

// insertImageDisplay —— editor doc 用 presigned URL（浏览器能渲染）。
// BlogEditor 的 onUpdate 在 emit body_md 前 contract 回 standmeet-asset:<id>
// URI（用 onUploaded 喂进去的 id↔url 映射）。
function insertImageDisplay(view: EditorView, alt: string, url: string): void {
  const { schema } = view.state;
  const node = schema.nodes['image']?.create({ src: url, alt });
  if (!node) return;
  view.dispatch(view.state.tr.replaceSelectionWith(node));
}
