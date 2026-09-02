// upload-asset.ts —— image handling helper inside the editor (keeps
// the File in front-end memory, doesn't upload right away).
//
// Flow: owner pastes/drags an image → ImageUpload extension assigns a
// client-side `pending-<id>` → the file is stored in an in-memory Map →
// the editor's body_md gets `standmeet-asset:pending-<id>` → display
// uses URL.createObjectURL(File) for a local blob URL.
//
// owner clicks save → WritingForm sends body_md + the pending Files
// together as a multipart POST/PATCH to /api/admin/writings/ → the
// server uploads + inserts + rewrites in one transaction → returns the
// new body_md (with real asset ids) + asset_urls (presigned).

export const ASSET_URI_SCHEME = 'standmeet-asset:';

// PendingFile —— a file in the editor's memory, pending save.
export interface PendingFile {
  id: string; // 'pending-' + uuid
  file: File;
  objectURL: string; // URL.createObjectURL(file)
}

// newPendingID —— assigns a client-side id to a newly pasted image. The
// format must match the backend's standmeet-asset regex (pending-[0-9a-zA-Z_-]+).
export function newPendingID(): string {
  const rand = crypto.randomUUID();
  return 'pending-' + rand;
}

// assetURI —— builds the URI written into markdown.
export function assetURI(id: string): string {
  return ASSET_URI_SCHEME + id;
}
