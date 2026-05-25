// use-obsidian.ts —— Obsidian vault 双向同步的 admin hook。
//
// export: GET /api/admin/obsidian/export → application/zip。browser 走
//   anchor[download] 触发下载。
// import: POST /api/admin/obsidian/import multipart，每个 file field 名
//   format 是 'file:<index>'，FileHeader.filename = webkitRelativePath
//   (path 从 vault root 算)。response = { created, updated, skipped, errors }。

import { useState } from 'react';

const CSRF_COOKIE = 'csrftoken';

function readCSRFCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match?.slice(CSRF_COOKIE.length + 1) ?? '';
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// triggerExport —— 直接走 anchor[download] 触发；不经 fetch + blob 路径，
// 避免大 vault 把 zip 全部读进内存。
export function triggerExport(): void {
  if (typeof window === 'undefined') return;
  const a = document.createElement('a');
  a.href = '/api/admin/obsidian/export';
  a.download = 'standmeet-vault.zip';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// uploadVault —— owner 通过 <input type="file" webkitdirectory> 选了整个
// vault 目录，browser 给一组 File，每个 File.webkitRelativePath 是 vault 内
// 相对路径（含 vault 名前缀）。这里组装 multipart 上传。
export async function uploadVault(files: FileList): Promise<ImportResult> {
  const fd = new FormData();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    // 用 webkitRelativePath 作为 filename，server 那侧能恢复 vault 内目录结构。
    const rel = relPathOf(f);
    fd.append('file:' + String(i), f, rel);
  }
  const headers: Record<string, string> = {};
  const csrf = readCSRFCookie();
  csrf && (headers['X-Csrftoken'] = csrf);
  const res = await fetch('/api/admin/obsidian/import', {
    method: 'POST', headers, body: fd, credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`import failed: ${res.status}`);
  }
  return await res.json() as ImportResult;
}

function relPathOf(f: File): string {
  const withPath = f as unknown as { webkitRelativePath?: string };
  return withPath.webkitRelativePath ?? f.name;
}

// useObsidianImport —— UI 用：picker 触发的 batch 上传，loading + 结果显示。
export function useObsidianImport(onDone: () => void): {
  busy: boolean;
  result: ImportResult | null;
  importVault: (files: FileList) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const importVault = async (files: FileList) => {
    setBusy(true);
    try {
      const r = await uploadVault(files);
      setResult(r);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, importVault };
}
