// upload-asset.ts —— editor 用的 image 上传 helper。
// 走 admin 的 multipart /assets 端点，返 { id, url } 给调用方。
// id 用于插 stable `standmeet-asset:<id>` URI；url 用于即时显示。

import { adminAPI } from '@/lib/api/admin';

export interface UploadedAsset {
  id: string;
  url: string;
  contentType: string;
}

interface AssetResp {
  id: string;
  url: string;
  content_type: string;
}

export async function uploadAsset(file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file);
  const res = await adminAPI.postForm<AssetResp>('/assets/', form);
  return { id: res.id, url: res.url, contentType: res.content_type };
}

export const ASSET_URI_SCHEME = 'standmeet-asset:';
