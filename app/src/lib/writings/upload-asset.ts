// upload-asset.ts —— editor 内 image 处理 helper（前端内存里挂 File，不
// 立即上传）。
//
// 流程：owner 粘/拖图 → ImageUpload extension 分配 client-side `pending-<id>`
// → 文件存进内存 Map → editor body_md 写 `standmeet-asset:pending-<id>` →
// 显示用 URL.createObjectURL(File) 拿本地 blob URL。
//
// owner 点 save → WritingForm 把 body_md + pending Files 一并 multipart POST/
// PATCH 到 /api/admin/writings/ → server 同事务上传 + insert + rewrite → 返
// 新 body_md（含真 asset id）+ asset_urls (presigned)。

export const ASSET_URI_SCHEME = 'standmeet-asset:';

// PendingFile —— 编辑器内存里的待保存 file。
export interface PendingFile {
  id: string; // 'pending-' + uuid
  file: File;
  objectURL: string; // URL.createObjectURL(file)
}

// newPendingID —— 给一张新粘进来的 image 分配 client-side id。format
// 必须跟 backend 的 standmeet-asset regex 一致（pending-[0-9a-zA-Z_-]+）。
export function newPendingID(): string {
  const rand = crypto.randomUUID();
  return 'pending-' + rand;
}

// assetURI —— 构造 markdown 里写的 URI。
export function assetURI(id: string): string {
  return ASSET_URI_SCHEME + id;
}
