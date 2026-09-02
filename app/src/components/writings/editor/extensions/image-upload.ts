// image-upload.ts — editor catches paste/drop image. Doesn't upload
// immediately: assigns a client-side `pending-<id>`, stores the File in
// editor storage (caller pulls it out of WritingEditor and submits it as
// multipart along with body_md). Markdown holds
// `standmeet-asset:pending-<id>`; display uses URL.createObjectURL for a blob URL.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { newPendingID, assetURI, type PendingFile } from '@/lib/writings/upload-asset';

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

// insertPending — doesn't upload, assigns a pending-id + stores the File,
// inserts an image node with src=URI into the editor doc (blob URL for
// display in the current session; the onPending callback feeds the
// PendingFile back to WritingEditor so WritingForm collects it on save).
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
